package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	"dashboard/pb"
)

type server struct {
	accountClient      pb.AccountDatabaseServiceClient
	orchestratorClient pb.OrchestratorServiceClient
	emailClient        pb.EmailServiceClient
	db                 *sql.DB
	staticDir          string
	mailboxRegisterMu     sync.Mutex
	mailboxRegistering    bool
	mailboxRegisterCancel context.CancelFunc
}

type jobRow struct {
	JobID        string    `json:"job_id"`
	AccountID    string    `json:"account_id"`
	Action       string    `json:"action"`
	Status       string    `json:"status"`
	Recoverable  bool      `json:"recoverable"`
	Retryable    bool      `json:"retryable"`
	LastStep     string    `json:"last_step"`
	ErrorMessage string    `json:"error_message"`
	ResultJSON   string    `json:"result_json"`
	RetryCount   int       `json:"retry_count"`
	TrafficBytes int64     `json:"traffic_bytes"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	Steps        []stepRow `json:"steps,omitempty"`
}

type stepRow struct {
	JobID        string    `json:"job_id,omitempty"`
	StepName     string    `json:"step_name"`
	Status       string    `json:"status"`
	Recoverable  bool      `json:"recoverable"`
	Retryable    bool      `json:"retryable"`
	ErrorMessage string    `json:"error_message"`
	ResultJSON   string    `json:"result_json"`
	StartedAt    int64     `json:"started_at"`
	CompletedAt  int64     `json:"completed_at"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type createAccountRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type upsertMailboxRequest struct {
	MailboxID    string `json:"mailbox_id"`
	Email        string `json:"email"`
	Password     string `json:"password"`
	RefreshToken string `json:"refresh_token"`
	AccessToken  string `json:"access_token"`
	Status       string `json:"status"`
	LastError    string `json:"last_error"`
}

type mailboxOAuthRequest struct {
	EmailAddress string `json:"email_address"`
	OnlyMissing  bool   `json:"only_missing"`
	Limit        int32  `json:"limit"`
}

type submitJobOTPRequest struct {
	OTP string `json:"otp"`
}

type updateAccountRequest struct {
	SessionToken string `json:"session_token"`
	AccessToken  string `json:"access_token"`
}

func main() {
	ctx := context.Background()

	accountConn, err := grpc.NewClient(envDefault("ACCOUNT_DB_ADDR", "account-db:50051"), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("connect account-db: %v", err)
	}
	defer accountConn.Close()

	orchestratorConn, err := grpc.NewClient(envDefault("ORCHESTRATOR_ADDR", "orchestrator:50051"), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("connect orchestrator: %v", err)
	}
	defer orchestratorConn.Close()

	emailConn, err := grpc.NewClient(envDefault("EMAIL_ADDR", "outlook-imap-service:50051"), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Fatalf("connect email service: %v", err)
	}
	defer emailConn.Close()

	pg, err := sql.Open("pgx", envDefault("ORCHESTRATOR_PG_DSN", envDefault("PG_DSN", "")))
	if err != nil {
		log.Fatalf("open postgres: %v", err)
	}
	if err := pg.PingContext(ctx); err != nil {
		log.Fatalf("ping postgres: %v", err)
	}
	defer pg.Close()

	s := &server{
		accountClient:      pb.NewAccountDatabaseServiceClient(accountConn),
		orchestratorClient: pb.NewOrchestratorServiceClient(orchestratorConn),
		emailClient:        pb.NewEmailServiceClient(emailConn),
		db:                 pg,
		staticDir:          envDefault("STATIC_DIR", "web/dist"),
	}

	s.db.ExecContext(ctx, `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0`)
	s.db.ExecContext(ctx, `ALTER TABLE mailboxes ADD COLUMN IF NOT EXISTS fail_count INTEGER NOT NULL DEFAULT 0`)
	s.initBatchTable(ctx)
	s.resumeBatch()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/accounts", s.handleAccounts)
	mux.HandleFunc("/api/accounts/", s.handleAccount)
	mux.HandleFunc("/api/mailboxes/register", s.handleMailboxRegister)
	mux.HandleFunc("/api/mailboxes/oauth", s.handleMailboxOAuth)
	mux.HandleFunc("/api/mailboxes/wait-otp", s.handleMailboxWaitOTP)
	mux.HandleFunc("/api/mailboxes/", s.handleMailbox)
	mux.HandleFunc("/api/mailboxes", s.handleMailboxes)
	mux.HandleFunc("/api/jobs", s.handleJobs)
	mux.HandleFunc("/api/jobs/", s.handleJob)
	mux.HandleFunc("/api/workflows/register", s.handleRegister)
	mux.HandleFunc("/api/workflows/activate", s.handleActivate)
	mux.HandleFunc("/api/workflows/probe-plus-trial", s.handleProbePlusTrial)
	mux.HandleFunc("/api/workflows/register-and-activate", s.handleRegisterAndActivate)
	mux.HandleFunc("/api/stats", s.handleStats)
	mux.HandleFunc("/", s.handleStatic)

	addr := envDefault("LISTEN_ADDR", ":8080")
	log.Printf("dashboard listening on %s", addr)
	if err := http.ListenAndServe(addr, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *server) handleAccounts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		limit := int32(queryInt(r, "limit", 100))
		resp, err := s.accountClient.ListAccounts(r.Context(), &pb.ListAccountsRequest{
			Status: r.URL.Query().Get("status"),
			Limit:  limit,
		})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		accounts := resp.GetAccounts()
		if accounts == nil {
			accounts = []*pb.Account{}
		}
		writeJSON(w, http.StatusOK, accounts)
	case http.MethodPost:
		var req createAccountRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		accountID := randomID()
		email := strings.TrimSpace(req.Email)
		if email == "" {
			emailResp, err := s.emailClient.GetEmail(r.Context(), &pb.GetEmailRequest{})
			if err != nil {
				writeError(w, http.StatusBadGateway, err)
				return
			}
			email = emailResp.GetEmailAddress()
		}
		resp, err := s.accountClient.CreateAccount(r.Context(), &pb.CreateAccountRequest{Account: &pb.Account{
			AccountId: accountID,
			Email:     email,
			Password:  req.Password,
		}})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusCreated, resp.GetAccount())
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) handleMailboxes(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodDelete:
		status := r.URL.Query().Get("status")
		if status == "" {
			writeError(w, http.StatusBadRequest, errors.New("status query parameter is required (e.g. AUTH_FAILED, BLOCKED)"))
			return
		}
		minFail := queryInt(r, "min_fail_count", 0)
		var result sql.Result
		var err error
		if minFail > 0 {
			result, err = s.db.ExecContext(r.Context(), `DELETE FROM mailboxes WHERE status = $1 AND COALESCE(fail_count,0) >= $2`, status, minFail)
		} else {
			result, err = s.db.ExecContext(r.Context(), `DELETE FROM mailboxes WHERE status = $1`, status)
		}
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		n, _ := result.RowsAffected()
		writeJSON(w, http.StatusOK, map[string]any{"deleted": n, "status": status, "min_fail_count": minFail})
	case http.MethodGet:
		limit := int32(queryInt(r, "limit", 100))
		resp, err := s.emailClient.ListMailboxes(r.Context(), &pb.ListEmailMailboxesRequest{
			Status: r.URL.Query().Get("status"),
			Limit:  limit,
		})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		mailboxes := resp.GetMailboxes()
		if mailboxes == nil {
			mailboxes = []*pb.EmailMailbox{}
		}
		writeJSON(w, http.StatusOK, mailboxes)
	case http.MethodPost:
		var req upsertMailboxRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		resp, err := s.emailClient.UpsertMailbox(r.Context(), &pb.UpsertEmailMailboxRequest{Mailbox: &pb.EmailMailbox{
			EmailAddress: req.Email,
			Password:     req.Password,
			RefreshToken: req.RefreshToken,
			AccessToken:  req.AccessToken,
			Status:       req.Status,
			LastError:    req.LastError,
			IsPrimary:    true,
			PrimaryEmail: req.Email,
		}})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusCreated, resp.GetMailbox())
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) handleMailbox(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/mailboxes/")
	switch path {
	case "register", "oauth", "wait-otp":
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if strings.Contains(path, "/") {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	email := path
	if email == "" {
		writeError(w, http.StatusBadRequest, errors.New("email is required"))
		return
	}

	switch r.Method {
	case http.MethodDelete:
		result, err := s.db.ExecContext(r.Context(), `DELETE FROM mailboxes WHERE email = $1`, email)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		n, _ := result.RowsAffected()
		if n == 0 {
			writeError(w, http.StatusNotFound, errors.New("mailbox not found"))
			return
		}
		// also delete aliases
		s.db.ExecContext(r.Context(), `DELETE FROM mailboxes WHERE primary_email = $1 AND is_primary = false`, email)
		writeJSON(w, http.StatusOK, map[string]string{"deleted": email})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// ─── Batch registration with DB persistence ───

func (s *server) initBatchTable(ctx context.Context) {
	_, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS batch_registration (
			id         SERIAL PRIMARY KEY,
			total      INT NOT NULL,
			done       INT NOT NULL DEFAULT 0,
			cancelled  BOOLEAN NOT NULL DEFAULT FALSE,
			continuous BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`)
	if err != nil {
		log.Fatalf("create batch_registration table: %v", err)
	}
	// add columns if upgrading from older schema
	s.db.ExecContext(ctx, `ALTER TABLE batch_registration ADD COLUMN IF NOT EXISTS continuous BOOLEAN NOT NULL DEFAULT FALSE`)
	s.db.ExecContext(ctx, `ALTER TABLE batch_registration ADD COLUMN IF NOT EXISTS email_prefix TEXT NOT NULL DEFAULT ''`)
	s.db.ExecContext(ctx, `ALTER TABLE batch_registration ADD COLUMN IF NOT EXISTS email_suffix TEXT NOT NULL DEFAULT ''`)
}

type batchState struct {
	ID          int
	Total       int
	Done        int
	Cancelled   bool
	Continuous  bool
	EmailPrefix string
	EmailSuffix string
}

func (s *server) loadActiveBatch() *batchState {
	row := s.db.QueryRow(`SELECT id, total, done, cancelled, continuous, email_prefix, email_suffix FROM batch_registration WHERE cancelled = FALSE AND (done < total OR continuous = TRUE) ORDER BY id DESC LIMIT 1`)
	var b batchState
	if err := row.Scan(&b.ID, &b.Total, &b.Done, &b.Cancelled, &b.Continuous, &b.EmailPrefix, &b.EmailSuffix); err != nil {
		return nil
	}
	return &b
}

func (s *server) resumeBatch() {
	b := s.loadActiveBatch()
	if b == nil {
		return
	}
	log.Printf("resuming batch %d: done=%d total=%d continuous=%v prefix=%q suffix=%q", b.ID, b.Done, b.Total, b.Continuous, b.EmailPrefix, b.EmailSuffix)
	s.startBatchLoop(b.ID, b.Total, b.Done, b.Continuous, b.EmailPrefix, b.EmailSuffix)
}

func (s *server) startBatchLoop(batchID, total, startFrom int, continuous bool, emailPrefix, emailSuffix string) {
	s.mailboxRegisterMu.Lock()
	if s.mailboxRegistering {
		s.mailboxRegisterMu.Unlock()
		return
	}
	s.mailboxRegistering = true
	batchCtx, batchCancel := context.WithCancel(context.Background())
	s.mailboxRegisterCancel = batchCancel
	s.mailboxRegisterMu.Unlock()

	go func() {
		defer func() {
			batchCancel()
			s.mailboxRegisterMu.Lock()
			s.mailboxRegistering = false
			s.mailboxRegisterCancel = nil
			s.mailboxRegisterMu.Unlock()
		}()
		timeoutPerJob := time.Duration(envInt("MAILBOX_REGISTER_TIMEOUT_SECONDS", 1800)) * time.Second
		cooldownThreshold := time.Duration(envInt("MAILBOX_REGISTER_COOLDOWN_THRESHOLD_SECONDS", 2)) * time.Second
		cooldownPause := time.Duration(envInt("MAILBOX_REGISTER_COOLDOWN_PAUSE_SECONDS", 60)) * time.Second
		consecutiveFastCount := 0

		for i := startFrom + 1; continuous || i <= total; i++ {
			if batchCtx.Err() != nil {
				s.db.Exec(`UPDATE batch_registration SET cancelled = TRUE WHERE id = $1`, batchID)
				log.Printf("mailbox registration batch %d cancelled at %d", batchID, i)
				return
			}

			start := time.Now()
			ctx, cancel := context.WithTimeout(batchCtx, timeoutPerJob)
			resp, err := s.orchestratorClient.RegisterMailbox(ctx, &pb.RegisterMailboxRequest{
				EmailPrefix: emailPrefix,
				EmailSuffix: emailSuffix,
			})
			cancel()
			elapsed := time.Since(start)

			// update done counter
			if continuous {
				s.db.Exec(`UPDATE batch_registration SET done = done + 1, total = done + 1 WHERE id = $1`, batchID)
			} else {
				s.db.Exec(`UPDATE batch_registration SET done = $1 WHERE id = $2`, i, batchID)
			}

			label := fmt.Sprintf("[%d", i)
			if !continuous {
				label += fmt.Sprintf("/%d", total)
			}
			label += fmt.Sprintf("] batch=%d", batchID)

			if err != nil {
				log.Printf("mailbox registration %s failed (%s): %v", label, elapsed.Truncate(time.Second), err)
			} else if resp.GetErrorMessage() != "" {
				log.Printf("mailbox registration %s job=%s failed (%s): %s", label, resp.GetJobId(), elapsed.Truncate(time.Second), resp.GetErrorMessage())
			} else {
				log.Printf("mailbox registration %s job=%s success=%v (%s)", label, resp.GetJobId(), resp.GetSuccess(), elapsed.Truncate(time.Second))
				// warm-up: poll each newly registered mailbox to activate OAuth token path
				for _, mb := range resp.GetMailboxes() {
					email := mb.GetEmailAddress()
					if email == "" {
						continue
					}
					go func(addr string) {
						warmCtx, warmCancel := context.WithTimeout(context.Background(), 15*time.Second)
						defer warmCancel()
						_, warmErr := s.emailClient.WaitForEmail(warmCtx, &pb.WaitForEmailRequest{
							EmailAddress:   addr,
							SubjectKeyword: "__warmup__",
							TimeoutSeconds: 1,
						})
						if warmErr != nil {
							log.Printf("mailbox warm-up poll for %s: %v (non-fatal)", addr, warmErr)
						} else {
							log.Printf("mailbox warm-up poll for %s: ok", addr)
						}
					}(email)
				}
			}

			// cooldown: if 3 consecutive jobs finish in < threshold, pause
			if elapsed < cooldownThreshold {
				consecutiveFastCount++
				if consecutiveFastCount >= 3 {
					log.Printf("mailbox registration %s: %d consecutive fast failures (<%.0fs), cooling down %.0fs", label, consecutiveFastCount, cooldownThreshold.Seconds(), cooldownPause.Seconds())
					consecutiveFastCount = 0
					select {
					case <-batchCtx.Done():
						s.db.Exec(`UPDATE batch_registration SET cancelled = TRUE WHERE id = $1`, batchID)
						return
					case <-time.After(cooldownPause):
					}
				}
			} else {
				consecutiveFastCount = 0
			}
		}
		log.Printf("mailbox registration batch %d finished", batchID)
	}()
}

func (s *server) handleMailboxRegister(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.mailboxRegisterMu.Lock()
		running := s.mailboxRegistering
		s.mailboxRegisterMu.Unlock()
		b := s.loadActiveBatch()
		var total, done, remaining int
		var continuous bool
		if b != nil {
			total = b.Total
			done = b.Done
			remaining = total - done
			continuous = b.Continuous
		}
		var emailPrefix, emailSuffix string
		if b != nil {
			emailPrefix = b.EmailPrefix
			emailSuffix = b.EmailSuffix
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"running":      running,
			"total":        total,
			"done":         done,
			"remaining":    remaining,
			"continuous":   continuous,
			"email_prefix": emailPrefix,
			"email_suffix": emailSuffix,
		})
	case http.MethodPost:
		var body struct {
			Count       int    `json:"count"`
			Cancel      bool   `json:"cancel"`
			Continuous  bool   `json:"continuous"`
			EmailPrefix string `json:"email_prefix"`
			EmailSuffix string `json:"email_suffix"`
		}
		_ = readJSON(r, &body)

		if body.Cancel {
			s.mailboxRegisterMu.Lock()
			if s.mailboxRegistering && s.mailboxRegisterCancel != nil {
				s.mailboxRegisterCancel()
			}
			s.mailboxRegisterMu.Unlock()
			res, _ := s.db.Exec(`UPDATE batch_registration SET cancelled = TRUE WHERE cancelled = FALSE AND (done < total OR continuous = TRUE)`)
			affected, _ := res.RowsAffected()
			writeJSON(w, http.StatusOK, map[string]any{"cancelled": affected > 0})
			return
		}

		continuous := body.Continuous
		count := body.Count
		if continuous {
			count = 0
		} else {
			if count <= 0 {
				count = 1
			}
			if count > 1000 {
				count = 1000
			}
		}

		s.mailboxRegisterMu.Lock()
		if s.mailboxRegistering {
			s.mailboxRegisterMu.Unlock()
			writeError(w, http.StatusConflict, errors.New("mailbox registration is already running"))
			return
		}
		s.mailboxRegisterMu.Unlock()

		// cancel any lingering DB batches
		s.db.Exec(`UPDATE batch_registration SET cancelled = TRUE WHERE cancelled = FALSE AND (done < total OR continuous = TRUE)`)
		// insert new batch
		var batchID int
		err := s.db.QueryRow(`INSERT INTO batch_registration (total, done, continuous, email_prefix, email_suffix) VALUES ($1, 0, $2, $3, $4) RETURNING id`, count, continuous, body.EmailPrefix, body.EmailSuffix).Scan(&batchID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}

		s.startBatchLoop(batchID, count, 0, continuous, body.EmailPrefix, body.EmailSuffix)

		writeJSON(w, http.StatusAccepted, map[string]any{
			"started":      true,
			"count":        count,
			"continuous":   continuous,
			"batch_id":     batchID,
			"email_prefix": body.EmailPrefix,
			"email_suffix": body.EmailSuffix,
		})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) handleMailboxOAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req mailboxOAuthRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if req.Limit <= 0 {
		req.Limit = 100
	}
	if strings.TrimSpace(req.EmailAddress) == "" {
		req.OnlyMissing = true
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	resp, err := s.orchestratorClient.RunMailboxOAuth(ctx, &pb.StartMailboxOAuthRequest{
		EmailAddress: strings.TrimSpace(req.EmailAddress),
		OnlyMissing:  req.OnlyMissing,
		Limit:        req.Limit,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	statusCode := http.StatusAccepted
	if !resp.GetStarted() || resp.GetErrorMessage() != "" {
		statusCode = http.StatusBadGateway
	}
	writeJSON(w, statusCode, map[string]any{
		"started":       resp.GetStarted(),
		"job_id":        resp.GetJobId(),
		"error_message": resp.GetErrorMessage(),
		"backend":       "outlook-register-service",
	})
}

func (s *server) handleAccount(w http.ResponseWriter, r *http.Request) {
	accountID := strings.TrimPrefix(r.URL.Path, "/api/accounts/")
	if accountID == "" {
		writeError(w, http.StatusBadRequest, errors.New("account_id is required"))
		return
	}

	switch r.Method {
	case http.MethodGet:
		resp, err := s.accountClient.GetAccount(r.Context(), &pb.GetAccountRequest{AccountId: accountID})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, resp.GetAccount())
	case http.MethodPatch, http.MethodPut:
		var req updateAccountRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err)
			return
		}
		sessionToken := strings.TrimSpace(req.SessionToken)
		accessToken := strings.TrimSpace(req.AccessToken)
		if sessionToken == "" && accessToken == "" {
			writeError(w, http.StatusBadRequest, errors.New("session_token or access_token is required"))
			return
		}
		resp, err := s.accountClient.UpdateAccount(r.Context(), &pb.UpdateAccountRequest{Account: &pb.Account{
			AccountId:    accountID,
			SessionToken: sessionToken,
			AccessToken:  accessToken,
		}})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, resp.GetAccount())
	case http.MethodDelete:
		resp, err := s.accountClient.DeleteAccount(r.Context(), &pb.DeleteAccountRequest{AccountId: accountID})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) handleJobs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		jobs, err := s.listJobs(r.Context(), r)
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, jobs)
	case http.MethodDelete:
		status := r.URL.Query().Get("status")
		if status == "" {
			writeError(w, http.StatusBadRequest, errors.New("status query parameter is required (e.g. FAILED, FAILED_RETRYABLE)"))
			return
		}
		// delete steps first, then jobs
		s.db.ExecContext(r.Context(), `DELETE FROM job_steps WHERE job_id IN (SELECT id FROM jobs WHERE status = $1)`, status)
		result, err := s.db.ExecContext(r.Context(), `DELETE FROM jobs WHERE status = $1`, status)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		n, _ := result.RowsAffected()
		writeJSON(w, http.StatusOK, map[string]any{"deleted": n, "status": status})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *server) handleJob(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/jobs/"), "/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		writeError(w, http.StatusBadRequest, errors.New("job_id is required"))
		return
	}
	jobID := strings.TrimSpace(parts[0])

	if len(parts) > 1 {
		switch parts[1] {
		case "retry":
			if r.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			s.retryJob(w, r, jobID)
			return
		case "otp":
			if r.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			s.submitJobOTP(w, r, jobID)
			return
		default:
			writeError(w, http.StatusNotFound, fmt.Errorf("unsupported job action: %s", parts[1]))
			return
		}
	}

	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	job, err := s.getJob(r.Context(), jobID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, job)
}

func (s *server) submitJobOTP(w http.ResponseWriter, r *http.Request, jobID string) {
	var req submitJobOTPRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	resp, err := s.orchestratorClient.SubmitRegistrationOtp(r.Context(), &pb.SubmitRegistrationOtpRequest{
		JobId: jobID,
		Otp:   req.OTP,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if resp.GetErrorMessage() != "" {
		writeError(w, http.StatusBadRequest, errors.New(resp.GetErrorMessage()))
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *server) retryJob(w http.ResponseWriter, r *http.Request, jobID string) {
	job, err := s.getJob(r.Context(), jobID)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	if !job.Retryable || !strings.HasPrefix(job.Status, "FAILED") {
		writeError(w, http.StatusConflict, errors.New("only retryable failed jobs can be retried"))
		return
	}
	s.db.ExecContext(r.Context(), `UPDATE jobs SET retry_count = COALESCE(retry_count,0) + 1 WHERE id = $1`, jobID)
	if strings.TrimSpace(job.AccountID) == "" {
		writeError(w, http.StatusBadRequest, errors.New("job account_id is empty"))
		return
	}

	switch job.Action {
	case "REGISTER":
		resp, err := s.orchestratorClient.RegisterAccount(r.Context(), &pb.RegisterAccountRequest{AccountId: job.AccountID})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	case "ACTIVATE":
		resp, err := s.orchestratorClient.ActivateAccount(r.Context(), &pb.ActivateAccountRequest{AccountId: job.AccountID})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	case "PROBE_PLUS_TRIAL":
		resp, err := s.orchestratorClient.ProbePlusTrial(r.Context(), &pb.ProbePlusTrialRequest{AccountId: job.AccountID})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	case "REGISTER_AND_ACTIVATE":
		resp, err := s.orchestratorClient.RegisterAndActivateAccount(r.Context(), &pb.RegisterAndActivateAccountRequest{AccountId: job.AccountID})
		if err != nil {
			writeError(w, http.StatusBadGateway, err)
			return
		}
		writeJSON(w, http.StatusOK, resp)
	default:
		writeError(w, http.StatusBadRequest, fmt.Errorf("unsupported job action: %s", job.Action))
	}
}

func (s *server) handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req pb.RegisterAccountRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	resp, err := s.orchestratorClient.RegisterAccount(r.Context(), &req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *server) handleActivate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req pb.ActivateAccountRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	resp, err := s.orchestratorClient.ActivateAccount(r.Context(), &req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *server) handleProbePlusTrial(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req pb.ProbePlusTrialRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	resp, err := s.orchestratorClient.ProbePlusTrial(r.Context(), &req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	statusCode := http.StatusAccepted
	if !resp.GetStarted() || resp.GetErrorMessage() != "" {
		statusCode = http.StatusBadGateway
	}
	writeJSON(w, statusCode, resp)
}

func (s *server) handleRegisterAndActivate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req pb.RegisterAndActivateAccountRequest
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	resp, err := s.orchestratorClient.RegisterAndActivateAccount(r.Context(), &req)
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *server) listJobs(ctx context.Context, r *http.Request) ([]jobRow, error) {
	limit := queryInt(r, "limit", 100)
	if limit <= 0 || limit > 1000 {
		limit = 1000
	}

	query := `SELECT id, account_id, action, status, recoverable, retryable, last_step, error_message, result_json, COALESCE(retry_count,0), COALESCE((SELECT (s.result_json::jsonb->>'traffic_bytes')::bigint FROM job_steps s WHERE s.job_id = jobs.id AND s.result_json IS NOT NULL AND s.result_json <> '' AND s.result_json <> 'null' AND s.result_json LIKE '%traffic_bytes%' ORDER BY s.completed_at DESC LIMIT 1), 0), to_timestamp(created_at), to_timestamp(updated_at) FROM jobs WHERE 1=1`
	args := []any{}
	if value := strings.TrimSpace(r.URL.Query().Get("status")); value != "" {
		args = append(args, value)
		query += fmt.Sprintf(" AND status = $%d", len(args))
	}
	if value := strings.TrimSpace(r.URL.Query().Get("action")); value != "" {
		args = append(args, value)
		query += fmt.Sprintf(" AND action = $%d", len(args))
	}
	if value := strings.TrimSpace(r.URL.Query().Get("account_id")); value != "" {
		args = append(args, value)
		query += fmt.Sprintf(" AND account_id = $%d", len(args))
	}
	args = append(args, limit)
	query += fmt.Sprintf(" ORDER BY updated_at DESC LIMIT $%d", len(args))

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := []jobRow{}
	for rows.Next() {
		var job jobRow
		if err := rows.Scan(&job.JobID, &job.AccountID, &job.Action, &job.Status, &job.Recoverable, &job.Retryable, &job.LastStep, &job.ErrorMessage, &job.ResultJSON, &job.RetryCount, &job.TrafficBytes, &job.CreatedAt, &job.UpdatedAt); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func (s *server) getJob(ctx context.Context, jobID string) (*jobRow, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, account_id, action, status, recoverable, retryable, last_step, error_message, result_json, COALESCE(retry_count,0), COALESCE((SELECT (s.result_json::jsonb->>'traffic_bytes')::bigint FROM job_steps s WHERE s.job_id = jobs.id AND s.result_json IS NOT NULL AND s.result_json <> '' AND s.result_json <> 'null' AND s.result_json LIKE '%traffic_bytes%' ORDER BY s.completed_at DESC LIMIT 1), 0), to_timestamp(created_at), to_timestamp(updated_at) FROM jobs WHERE id = $1`, jobID)
	var job jobRow
	if err := row.Scan(&job.JobID, &job.AccountID, &job.Action, &job.Status, &job.Recoverable, &job.Retryable, &job.LastStep, &job.ErrorMessage, &job.ResultJSON, &job.RetryCount, &job.TrafficBytes, &job.CreatedAt, &job.UpdatedAt); err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `SELECT job_id, step_name, status, recoverable, retryable, error_message, result_json, started_at, completed_at, to_timestamp(created_at), to_timestamp(updated_at) FROM job_steps WHERE job_id = $1 ORDER BY started_at ASC, step_name ASC`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var step stepRow
		if err := rows.Scan(&step.JobID, &step.StepName, &step.Status, &step.Recoverable, &step.Retryable, &step.ErrorMessage, &step.ResultJSON, &step.StartedAt, &step.CompletedAt, &step.CreatedAt, &step.UpdatedAt); err != nil {
			return nil, err
		}
		job.Steps = append(job.Steps, step)
	}
	return &job, rows.Err()
}

func (s *server) handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	ctx := r.Context()
	var totalJobs, successJobs, failedJobs int
	var totalTraffic int64
	// Count jobs
	jobRows, err := s.db.QueryContext(ctx, `SELECT status FROM jobs WHERE action = 'REGISTER_MAILBOX'`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	defer jobRows.Close()
	for jobRows.Next() {
		var status string
		if err := jobRows.Scan(&status); err != nil {
			continue
		}
		totalJobs++
		if strings.HasPrefix(status, "COMPLETED") || status == "SUCCEEDED" {
			successJobs++
		} else if strings.HasPrefix(status, "FAILED") {
			failedJobs++
		}
	}
	// Sum traffic from step-level result_json (always populated, unlike job-level)
	stepRows, err := s.db.QueryContext(ctx, `SELECT s.result_json FROM job_steps s JOIN jobs j ON s.job_id = j.id WHERE j.action = 'REGISTER_MAILBOX' AND s.step_name = 'register_mailbox'`)
	if err == nil {
		defer stepRows.Close()
		for stepRows.Next() {
			var resultJSON string
			if err := stepRows.Scan(&resultJSON); err != nil {
				continue
			}
			var parsed map[string]any
			if json.Unmarshal([]byte(resultJSON), &parsed) == nil {
				if tb, ok := parsed["traffic_bytes"]; ok {
					switch v := tb.(type) {
					case float64:
						totalTraffic += int64(v)
					case int64:
						totalTraffic += v
					}
				}
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"total_registrations":  totalJobs,
		"success_registrations": successJobs,
		"failed_registrations": failedJobs,
		"total_traffic_bytes":  totalTraffic,
		"total_traffic_mb":     float64(totalTraffic) / 1048576.0,
	})
}

func (s *server) handleStatic(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(s.staticDir, filepath.Clean(r.URL.Path))
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		http.ServeFile(w, r, path)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.staticDir, "index.html"))
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func readJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(dst)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *server) handleMailboxWaitOTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		EmailAddress   string `json:"email_address"`
		SubjectKeyword string `json:"subject_keyword"`
		TimeoutSeconds int32  `json:"timeout_seconds"`
	}
	if err := readJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if req.EmailAddress == "" {
		writeError(w, http.StatusBadRequest, errors.New("email_address is required"))
		return
	}
	if req.TimeoutSeconds <= 0 {
		req.TimeoutSeconds = 120
	}
	if req.TimeoutSeconds > 600 {
		req.TimeoutSeconds = 600
	}

	ctx, cancel := context.WithTimeout(r.Context(), time.Duration(req.TimeoutSeconds+5)*time.Second)
	defer cancel()

	resp, err := s.emailClient.WaitForEmail(ctx, &pb.WaitForEmailRequest{
		EmailAddress:   req.EmailAddress,
		SubjectKeyword: req.SubjectKeyword,
		TimeoutSeconds: req.TimeoutSeconds,
		IssuedAfterUnix: time.Now().Add(-10 * time.Minute).Unix(),
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"found":             resp.GetFound(),
		"content_extracted": resp.GetContentExtracted(),
	})
}

func queryInt(r *http.Request, key string, fallback int) int {
	value := strings.TrimSpace(r.URL.Query().Get(key))
	if value == "" {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return n
}

func envDefault(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return n
}

func tailString(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[len(value)-limit:]
}

func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}
