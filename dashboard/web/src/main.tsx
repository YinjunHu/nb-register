import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  Copy,
  Database,
  Eye,
  EyeOff,
  Inbox,
  KeyRound,
  ListChecks,
  Mail,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  ShieldCheck,
  MessageSquare,
  Trash2,
  X,
  Zap
} from 'lucide-react';
import './styles.css';

type Account = {
  account_id: string;
  email: string;
  password: string;
  status: string;
  error_message: string;
  session_token: string;
  access_token: string;
  plus_trial_eligible?: boolean;
  created_at: number;
  updated_at: number;
};

type Job = {
  job_id: string;
  account_id: string;
  action: string;
  status: string;
  recoverable: boolean;
  retryable: boolean;
  last_step: string;
  error_message: string;
  result_json: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
  steps?: Step[];
};

type Mailbox = {
  email_address: string;
  password: string;
  refresh_token: string;
  access_token: string;
  status: string;
  last_error: string;
  is_primary: boolean;
  primary_email: string;
  fail_count: number;
  created_at: number;
  updated_at: number;
};

type MailboxOAuthResponse = {
  started: boolean;
  job_id: string;
  error_message: string;
};

type Step = {
  step_name: string;
  status: string;
  recoverable: boolean;
  retryable: boolean;
  error_message: string;
  result_json: string;
  started_at: number;
  completed_at: number;
};

type Toast = { kind: 'ok' | 'error'; text: string } | null;
type ViewKey = 'accounts' | 'mailboxes' | 'mailboxRegistration' | 'otp' | 'jobs';
type Lang = 'zh' | 'en';

// ============== i18n 翻译 ==============
const ZH_STATUS: Record<string, string> = {
  RUNNING: '运行中', SUCCEEDED: '成功', FAILED_RETRYABLE: '失败(可重试)', FAILED_RECOVERABLE: '失败(可恢复)', FAILED_FINAL: '最终失败',
  CREATED: '已创建', REGISTERED: '已注册', ACTIVATED: '已激活', EMAIL_ALREADY_EXISTS: '邮箱已存在', REGISTER_FAILED: '注册失败', PAYMENT_FAILED: '支付失败',
  AVAILABLE: '可用', ASSIGNED: '已分配', OAUTH_PENDING: 'OAuth 进行中', USER_ALREADY_EXISTS: '用户已存在', REGISTRATION_FAILED: '注册失败', AUTH_FAILED: '认证失败', BLOCKED: '已封禁',
};

const ZH_ACTION: Record<string, string> = {
  REGISTER_MAILBOX: '邮箱注册', MAILBOX_OAUTH: '邮箱认证', REGISTER: '注册账号', ACTIVATE: '激活账号',
  REGISTER_AND_ACTIVATE: '注册并激活', PROBE_PLUS_TRIAL: '探测Plus试用',
};

const ZH_STEP: Record<string, string> = {
  register_mailbox: '注册邮箱', mailbox_oauth: '邮箱OAuth', register: '注册', activate: '激活',
  register_and_activate: '注册并激活', probe_plus_trial: '探测Plus试用',
};

const ZH_ERROR_PATTERNS: [RegExp, string][] = [
  [/mailbox registration completed but returned no account records/, '邮箱注册流程完成但未产生账号记录（可能是验证码/人机验证失败）'],
  [/mailbox registration failed with exit code (\d+)/, '邮箱注册脚本异常退出（退出码: $1）'],
  [/CAPTCHA failed/, '人机验证(CAPTCHA)失败'],
  [/Password fill failed.*Timeout/i, '密码填写超时（页面元素未加载）'],
  [/Page\.screenshot.*Timeout/i, '页面截图超时（网络加载缓慢）'],
  [/Timeout (\d+)ms exceeded/, '操作超时（$1ms）'],
  [/OAuth.*timed out/i, 'OAuth 认证超时'],
  [/mailbox registration is disabled/, '邮箱注册已禁用'],
  [/registration already running/, '已有注册任务在运行'],
  [/no mailbox records found to import/, '未找到可导入的邮箱记录'],
  [/Failed to get IP address/, '代理获取公网 IP 失败（代理不通）'],
  [/primary mailbox is not pollable.*status=AUTH_FAILED/, '主邮箱认证失效，无法收取邮件'],
  [/mailbox OAuth failed:\s*(\d+)\/(\d+)/, '邮箱 OAuth 失败（$1/$2）'],
  [/registered mailbox has no OAuth refresh token/, '已注册邮箱缺少 OAuth 令牌'],
  [/Registration failed/, '注册失败'],
];

function tStatus(status: string, lang: Lang): string {
  return lang === 'zh' ? (ZH_STATUS[status] || status) : status;
}
function tAction(action: string, lang: Lang): string {
  return lang === 'zh' ? (ZH_ACTION[action] || action) : action;
}
function tStep(step: string, lang: Lang): string {
  return lang === 'zh' ? (ZH_STEP[step] || step) : step;
}
function tError(msg: string, lang: Lang): string {
  if (lang !== 'zh' || !msg) return msg;
  for (const [pattern, replacement] of ZH_ERROR_PATTERNS) {
    if (pattern.test(msg)) return msg.replace(pattern, replacement);
  }
  return msg;
}

const statusOptions = ['', 'CREATED', 'REGISTERED', 'ACTIVATED', 'EMAIL_ALREADY_EXISTS', 'REGISTER_FAILED', 'PAYMENT_FAILED'];
const jobStatusOptions = ['', 'RUNNING', 'SUCCEEDED', 'FAILED_RETRYABLE', 'FAILED_RECOVERABLE', 'FAILED_FINAL'];
const mailboxStatusOptions = ['', 'AVAILABLE', 'ASSIGNED', 'REGISTERED', 'OAUTH_PENDING', 'USER_ALREADY_EXISTS', 'REGISTRATION_FAILED', 'AUTH_FAILED', 'BLOCKED'];

function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [activeView, setActiveView] = useState<ViewKey>('accounts');
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedMailbox, setSelectedMailbox] = useState<Mailbox | null>(null);
  const [accountStatus, setAccountStatus] = useState('');
  const [jobStatus, setJobStatus] = useState('');
  const [mailboxStatus, setMailboxStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [mailboxRegistering, setMailboxRegistering] = useState(false);
  const [mailboxRegisterCount, setMailboxRegisterCount] = useState(1);
  const [mailboxEmailCfg, setMailboxEmailCfg] = useState({ prefix: '', min: 8, max: 12, upper: false, lower: true, digit: true });
  const [mailboxEmailSuffix, setMailboxEmailSuffix] = useState('@outlook.com');
  const [mailboxRegisterProgress, setMailboxRegisterProgress] = useState<{running: boolean; total: number; done: number; remaining: number; continuous: boolean; email_prefix?: string; email_suffix?: string}>({running: false, total: 0, done: 0, remaining: 0, continuous: false});
  const [mailboxOAuthing, setMailboxOAuthing] = useState('');
  const [runningAccountIds, setRunningAccountIds] = useState<Set<string>>(new Set());
  const [runningJobCount, setRunningJobCount] = useState(0);
  const [otpEmail, setOtpEmail] = useState('');
  const [otpKeyword, setOtpKeyword] = useState('');
  const [otpTimeout, setOtpTimeout] = useState(120);
  const [otpResult, setOtpResult] = useState<{found: boolean; code: string; time: string} | null>(null);
  const [otpWaiting, setOtpWaiting] = useState(false);
  const [otpHistory, setOtpHistory] = useState<{email: string; keyword: string; code: string; found: boolean; time: string}[]>([]);
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('nb-lang') as Lang) || 'zh');
  const [trafficStats, setTrafficStats] = useState<{total_registrations: number; success_registrations: number; failed_registrations: number; total_traffic_bytes: number; total_traffic_mb: number}>({total_registrations: 0, success_registrations: 0, failed_registrations: 0, total_traffic_bytes: 0, total_traffic_mb: 0});

  async function refresh() {
    setBusy(true);
    try {
      const [accountsData, jobsData, mailboxesData, runningJobsData] = await Promise.all([
        api<Account[]>(`/api/accounts?limit=1000${accountStatus ? `&status=${accountStatus}` : ''}`),
        api<Job[]>(`/api/jobs?limit=1000${jobStatus ? `&status=${jobStatus}` : ''}`),
        api<Mailbox[]>(`/api/mailboxes?limit=1000${mailboxStatus ? `&status=${mailboxStatus}` : ''}`),
        api<Job[]>('/api/jobs?limit=1000&status=RUNNING')
      ]);
      setAccounts(Array.isArray(accountsData) ? accountsData : []);
      setJobs(Array.isArray(jobsData) ? jobsData : []);
      const nextMailboxes = Array.isArray(mailboxesData) ? mailboxesData : [];
      setMailboxes(nextMailboxes);
      const runningJobs = Array.isArray(runningJobsData) ? runningJobsData : [];
      setRunningJobCount(runningJobs.length);
      setRunningAccountIds(new Set(runningJobs.filter((job) => job.account_id).map((job) => job.account_id)));
      try {
        const prog = await api<{running: boolean; total: number; done: number; remaining: number; continuous: boolean}>('/api/mailboxes/register');
        setMailboxRegisterProgress(prog);
        setMailboxRegistering(prog.running);
      } catch {}
      try { setTrafficStats(await api('/api/stats')); } catch {}
      if (selectedJob) {
        setSelectedJob(await api<Job>(`/api/jobs/${selectedJob.job_id}`));
      }
      if (selectedMailbox) {
        const freshMailbox = nextMailboxes.find((mailbox) => mailbox.email_address === selectedMailbox.email_address);
        if (freshMailbox) setSelectedMailbox(freshMailbox);
      }
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function runAccountWorkflow(label: string, path: string, account: Account) {
    setBusy(true);
    try {
      const resp = await api<any>(path, { method: 'POST', body: JSON.stringify({ account_id: account.account_id }) });
      if (resp.error_message) {
        setToast({ kind: 'error', text: resp.error_message });
      } else {
        setToast({ kind: 'ok', text: `${label} 已提交: ${resp.job_id || 'ok'}` });
        await refresh();
      }
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(account: Account) {
    if (!window.confirm(`删除账号 ${account.email || account.account_id}？`)) return;
    setBusy(true);
    try {
      await api<any>(`/api/accounts/${account.account_id}`, { method: 'DELETE' });
      if (selectedAccount?.account_id === account.account_id) setSelectedAccount(null);
      setToast({ kind: 'ok', text: '账号已删除' });
      await refresh();
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function deleteMailbox(email: string) {
    setBusy(true);
    try {
      await api<any>(`/api/mailboxes/${encodeURIComponent(email)}`, { method: 'DELETE' });
      if (selectedMailbox?.email_address === email) setSelectedMailbox(null);
      setToast({ kind: 'ok', text: `邮箱 ${email} 已删除` });
      await refresh();
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function bulkDeleteMailboxes(status: string, minFailCount = 0) {
    setBusy(true);
    try {
      const qs = `status=${encodeURIComponent(status)}${minFailCount > 0 ? `&min_fail_count=${minFailCount}` : ''}`;
      const resp = await api<{ deleted: number; status: string }>(`/api/mailboxes?${qs}`, { method: 'DELETE' });
      setToast({ kind: 'ok', text: `已删除 ${resp.deleted} 个 ${status} 邮箱${minFailCount > 0 ? ` (失败≥${minFailCount}次)` : ''}` });
      if (selectedMailbox?.status === status) setSelectedMailbox(null);
      await refresh();
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function bulkDeleteJobs(status: string) {
    setBusy(true);
    try {
      const resp = await api<{ deleted: number; status: string }>(`/api/jobs?status=${encodeURIComponent(status)}`, { method: 'DELETE' });
      setToast({ kind: 'ok', text: `已删除 ${resp.deleted} 条 ${status} 工作流` });
      if (selectedJob?.status === status) setSelectedJob(null);
      await refresh();
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function retryJob(job: Job) {
    setBusy(true);
    try {
      const resp = await api<any>(`/api/jobs/${job.job_id}/retry`, { method: 'POST', body: '{}' });
      if (resp.error_message) {
        setToast({ kind: 'error', text: resp.error_message });
      } else {
        setToast({ kind: 'ok', text: `流程已重试: ${resp.job_id || 'ok'}` });
        await refresh();
      }
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function submitJobOtp(job: Job, otp: string) {
    try {
      const resp = await api<{ success: boolean; job_id: string; error_message?: string }>(`/api/jobs/${job.job_id}/otp`, {
        method: 'POST',
        body: JSON.stringify({ otp })
      });
      if (resp.error_message || !resp.success) {
        setToast({ kind: 'error', text: resp.error_message || 'OTP 提交失败' });
        return;
      }
      setToast({ kind: 'ok', text: `OTP 已提交: ${short(resp.job_id || job.job_id)}` });
      await refresh();
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
      throw err;
    }
  }

  async function waitForOTP() {
    if (!otpEmail) { setToast({ kind: 'error', text: '请选择或输入邮箱地址' }); return; }
    setOtpWaiting(true);
    setOtpResult(null);
    try {
      const data = await api<{found: boolean; content_extracted: string}>('/api/mailboxes/wait-otp', {
        method: 'POST',
        body: JSON.stringify({ email_address: otpEmail, subject_keyword: otpKeyword, timeout_seconds: otpTimeout }),
      });
      const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
      const result = { found: data.found, code: data.content_extracted || '', time: now };
      setOtpResult(result);
      setOtpHistory((prev) => [{ email: otpEmail, keyword: otpKeyword, ...result }, ...prev].slice(0, 50));
      if (data.found) setToast({ kind: 'ok', text: `收到验证码: ${data.content_extracted}` });
      else setToast({ kind: 'error', text: '超时未收到验证码' });
    } catch (err: any) {
      setToast({ kind: 'error', text: `接码失败: ${err.message}` });
    } finally {
      setOtpWaiting(false);
    }
  }

  async function startMailboxRegistration(continuous = false) {
    setMailboxRegistering(true);
    try {
      const emailPrefix = JSON.stringify(mailboxEmailCfg);
      const resp = await api<{ started: boolean; count?: number; continuous?: boolean }>('/api/mailboxes/register', { method: 'POST', body: JSON.stringify(continuous ? { continuous: true, email_prefix: emailPrefix, email_suffix: mailboxEmailSuffix } : { count: mailboxRegisterCount, email_prefix: emailPrefix, email_suffix: mailboxEmailSuffix }) });
      const label = continuous ? '持续注册已启动' : `批量注册已启动 (${resp.count || 1} 个)`;
      setToast({ kind: resp.started ? 'ok' : 'error', text: resp.started ? label : '注册启动失败' });
      window.setTimeout(refresh, 3000);
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    } finally {
      setMailboxRegistering(false);
    }
  }

  async function cancelMailboxRegistration() {
    try {
      const resp = await api<{ cancelled: boolean }>('/api/mailboxes/register', { method: 'POST', body: JSON.stringify({ cancel: true }) });
      if (resp.cancelled) {
        setToast({ kind: 'ok', text: '已取消剩余注册任务' });
        window.setTimeout(refresh, 1000);
      } else {
        setToast({ kind: 'error', text: '取消失败：当前没有运行中的批量任务' });
      }
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    }
  }

  async function runMailboxOAuth(emailAddress = '') {
    setMailboxOAuthing(emailAddress || '*');
    try {
      const resp = await api<MailboxOAuthResponse>('/api/mailboxes/oauth', {
        method: 'POST',
        body: JSON.stringify({
          email_address: emailAddress,
          only_missing: !emailAddress,
          limit: 100
        })
      });
      if (!resp.started || resp.error_message) {
        setToast({ kind: 'error', text: resp.error_message || 'OAuth 流程启动失败' });
      } else {
        setToast({ kind: 'ok', text: `OAuth 流程已提交: ${short(resp.job_id)}` });
      }
      await refresh();
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    } finally {
      setMailboxOAuthing('');
    }
  }

  async function updateAccountAuth(account: Account, payload: { session_token?: string; access_token?: string }) {
    setBusy(true);
    try {
      const updated = await api<Account>(`/api/accounts/${account.account_id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      setAccounts((prev) => prev.map((item) => item.account_id === updated.account_id ? updated : item));
      setSelectedAccount(updated);
      setToast({ kind: 'ok', text: '认证信息已更新' });
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
      throw err;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    const interval = mailboxRegisterProgress.running ? 5000 : 15000;
    const id = window.setInterval(refresh, interval);
    return () => window.clearInterval(id);
  }, [accountStatus, jobStatus, mailboxStatus, mailboxRegisterProgress.running]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), toast.kind === 'error' ? 6000 : 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  function selectAccount(account: Account) {
    setSelectedAccount(account);
    setSelectedJob(null);
    setSelectedMailbox(null);
  }

  async function selectJob(job: Job) {
    try {
      setSelectedAccount(null);
      setSelectedMailbox(null);
      setSelectedJob(await api<Job>(`/api/jobs/${job.job_id}`));
    } catch (err) {
      setToast({ kind: 'error', text: errorText(err) });
    }
  }

  function selectMailbox(mailbox: Mailbox) {
    setSelectedAccount(null);
    setSelectedJob(null);
    setSelectedMailbox(mailbox);
  }

  function closeDetails() {
    setSelectedAccount(null);
    setSelectedJob(null);
    setSelectedMailbox(null);
  }

  function openView(view: ViewKey) {
    setActiveView(view);
    closeDetails();
  }

  const missingOAuthCount = mailboxes.filter((mailbox) => mailbox.is_primary && mailbox.password && !mailbox.refresh_token).length;
  const mailboxRegisterJobs = jobs.filter((job) => job.action === 'REGISTER_MAILBOX');
  const mailboxOAuthJobs = jobs.filter((job) => job.action === 'MAILBOX_OAUTH');
  const runningMailboxRegisterCount = mailboxRegisterJobs.filter((job) => job.status === 'RUNNING').length;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <h1>NB Register</h1>
          <p>账号、注册、激活和 GoPay 工作流控制台</p>
        </div>
        <div className="topbarActions">
          <button className="secondaryButton" onClick={() => { const next: Lang = lang === 'zh' ? 'en' : 'zh'; setLang(next); localStorage.setItem('nb-lang', next); }} title="切换语言 / Switch Language" style={{ fontSize: 13, padding: '4px 10px' }}>
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
          <button className="primaryButton" onClick={refresh} disabled={busy}>
            <RefreshCcw size={16} /> 刷新
          </button>
        </div>
      </header>

      {toast && <div className={`toast ${toast.kind}`} title={toast.text}>{compactToast(toast.text)}</div>}

      <section className="appFrame">
        <nav className="navRail" aria-label="主导航">
          <NavItem active={activeView === 'accounts'} icon={<Database size={17} />} label="账号" count={accounts.length} onClick={() => openView('accounts')} />
          <NavItem active={activeView === 'mailboxes'} icon={<Inbox size={17} />} label="邮箱管理" count={mailboxes.filter((m) => m.status === 'AVAILABLE').length} onClick={() => openView('mailboxes')} />
          <NavItem active={activeView === 'mailboxRegistration'} icon={<Play size={17} />} label="邮箱注册" count={runningMailboxRegisterCount} onClick={() => openView('mailboxRegistration')} />
          <NavItem active={activeView === 'otp'} icon={<MessageSquare size={17} />} label="接码" onClick={() => openView('otp')} />
          <NavItem active={activeView === 'jobs'} icon={<ListChecks size={17} />} label="工作流" count={runningJobCount} onClick={() => openView('jobs')} />
        </nav>

        <div className="contentPane">
          <section className="metrics">
            <Metric label="账号" value={accounts.length} icon={<ShieldCheck />} />
            <Metric label="已激活" value={accounts.filter((a) => a.status === 'ACTIVATED').length} icon={<Zap />} />
            <Metric label="可用邮箱" value={mailboxes.filter((m) => m.status === 'AVAILABLE').length} icon={<Mail />} />
            <Metric label="运行中 Job" value={runningJobCount} icon={<Activity />} />
            <Metric label="可重试失败" value={jobs.filter((j) => j.retryable).length} icon={<RefreshCcw />} />
          </section>

          {activeView === 'accounts' && (
            <section className="workspace accountsWorkspace">
              <div className="panel accountsPanel">
                <PanelHeader title="账号" icon={<Search size={16} />}>
                  <div className="headerControls">
                    <button className="secondaryButton" onClick={() => setShowSecrets((v) => !v)}>
                      {showSecrets ? <EyeOff size={16} /> : <Eye size={16} />}
                      {showSecrets ? '隐藏' : '显示'}
                    </button>
                    <select value={accountStatus} onChange={(e) => setAccountStatus(e.target.value)}>
                      {statusOptions.map((s) => <option key={s} value={s}>{s ? tStatus(s, lang) : '全部状态'}</option>)}
                    </select>
                  </div>
                </PanelHeader>
                <CreateAccountForm
                  onDone={async (message) => {
                    setToast({ kind: 'ok', text: message });
                    await refresh();
                  }}
                  onError={(message) => setToast({ kind: 'error', text: message })}
                />
                <AccountTable
                  accounts={accounts}
                  selected={selectedAccount?.account_id}
                  showSecrets={showSecrets}
                  runningAccountIds={runningAccountIds}
                  busy={busy}
                  onSelect={selectAccount}
                  onRegister={(account) => runAccountWorkflow('注册账号', '/api/workflows/register', account)}
                  onActivate={(account) => runAccountWorkflow('激活账号', '/api/workflows/activate', account)}
                  onProbePlusTrial={(account) => runAccountWorkflow('资格探测', '/api/workflows/probe-plus-trial', account)}
                  onRegisterActivate={(account) => runAccountWorkflow('注册并激活', '/api/workflows/register-and-activate', account)}
                  onDelete={deleteAccount}
                />
              </div>

              <div className="panel jobsPanel compactPanel">
                <PanelHeader title="最近工作流" icon={<Activity size={16} />}>
                  <button className="secondaryButton" onClick={() => openView('jobs')}>查看全部</button>
                </PanelHeader>
                <JobTable jobs={jobs.slice(0, 20)} selected={selectedJob?.job_id} busy={busy} lang={lang} onSelect={selectJob} onRetry={retryJob} />
              </div>
            </section>
          )}

          {activeView === 'mailboxes' && (
            <section className="workspace mailboxWorkspace">
              <div className="panel mailboxesPanel">
                <PanelHeader title="邮箱管理" icon={<Mail size={16} />}>
                  <div className="headerControls">
                    <button className="secondaryButton" onClick={() => runMailboxOAuth()} disabled={busy || !!mailboxOAuthing || missingOAuthCount === 0}>
                      <KeyRound size={16} /> 补 OAuth {missingOAuthCount > 0 ? `(${missingOAuthCount})` : ''}
                    </button>
                    <button className="dangerButton" onClick={() => { const input = prompt('清理注册失败邮箱\n输入最低失败次数（0=全部删除，默认0）:', '0'); if (input === null) return; const n = Math.max(0, parseInt(input) || 0); if (!confirm(`确定删除所有注册失败邮箱${n > 0 ? `（失败≥${n}次）` : ''}？`)) return; bulkDeleteMailboxes('REGISTRATION_FAILED', n); bulkDeleteMailboxes('USER_ALREADY_EXISTS', n); }} disabled={busy} title="删除注册阶段失败的邮箱">
                      <Trash2 size={16} /> 清理注册失败
                    </button>
                    <button className="dangerButton" onClick={() => { const input = prompt('清理认证失败邮箱\n输入最低失败次数（0=全部删除，默认0）:', '0'); if (input === null) return; const n = Math.max(0, parseInt(input) || 0); if (!confirm(`确定删除所有认证失败邮箱${n > 0 ? `（失败≥${n}次）` : ''}？`)) return; bulkDeleteMailboxes('AUTH_FAILED', n); bulkDeleteMailboxes('BLOCKED', n); }} disabled={busy} title="删除OAuth认证阶段失败的邮箱">
                      <Trash2 size={16} /> 清理认证失败
                    </button>
                    <button className="secondaryButton" onClick={() => setShowSecrets((v) => !v)}>
                      {showSecrets ? <EyeOff size={16} /> : <Eye size={16} />}
                      {showSecrets ? '隐藏' : '显示'}
                    </button>
                    <select value={mailboxStatus} onChange={(e) => setMailboxStatus(e.target.value)}>
                      {mailboxStatusOptions.map((s) => <option key={s} value={s}>{s ? tStatus(s, lang) : '全部状态'}</option>)}
                    </select>
                  </div>
                </PanelHeader>
                <MailboxPanel
                  mailboxes={mailboxes}
	                  selected={selectedMailbox?.email_address}
	                  busy={busy}
	                  showSecrets={showSecrets}
                    oauthing={mailboxOAuthing}
	                  onSelect={selectMailbox}
                    onOAuth={runMailboxOAuth}
	                  onDone={async (message) => {
	                    setToast({ kind: 'ok', text: message });
	                    await refresh();
                  }}
                  onError={(message) => setToast({ kind: 'error', text: message })}
                />
                {mailboxOAuthJobs.length > 0 && (
                  <>
                    <div className="sectionTitle">
                      <h3>OAuth Job</h3>
                      <button className="secondaryButton" onClick={() => openView('jobs')}>
                        <ListChecks size={14} /> 全部工作流
                      </button>
                    </div>
                    <JobTable jobs={mailboxOAuthJobs} selected={selectedJob?.job_id} busy={busy} lang={lang} onSelect={selectJob} onRetry={retryJob} />
                  </>
                )}
	              </div>
	            </section>
	          )}

	          {activeView === 'mailboxRegistration' && (
	            <section className="workspace mailboxRegistrationWorkspace">
	              <div className="panel mailboxRegisterPanel">
	                <PanelHeader title="邮箱注册" icon={<Play size={16} />}>
	                  <div className="headerControls">
	                    <input type="number" min={1} max={1000} value={mailboxRegisterCount} onChange={(e) => setMailboxRegisterCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))} style={{ width: 56, textAlign: 'center' }} disabled={busy || mailboxRegistering} />
	                    <button className="primaryButton" onClick={() => startMailboxRegistration(false)} disabled={busy || mailboxRegistering}>
	                      <Play size={16} /> 启动注册 ({mailboxRegisterCount})
	                    </button>
	                    <button className="primaryButton" onClick={() => startMailboxRegistration(true)} disabled={busy || mailboxRegistering} style={{ background: '#6f42c1' }}>
	                      <RefreshCcw size={16} /> 持续注册
	                    </button>
	                    {mailboxRegisterProgress.running && (
	                      <button className="secondaryButton" onClick={cancelMailboxRegistration} style={{ color: '#d32f2f' }}>
	                        <X size={16} /> {mailboxRegisterProgress.continuous ? '停止持续注册' : `取消剩余 (${mailboxRegisterProgress.remaining})`}
	                      </button>
	                    )}
	                    <button className="secondaryButton" onClick={() => openView('mailboxes')}>
	                      <Inbox size={16} /> 邮箱管理
	                    </button>
	                  </div>
	                </PanelHeader>
	                <div style={{ padding: '10px 16px', background: 'var(--surface-1, #f6f8fa)', borderBottom: '1px solid var(--border, #e1e4e8)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
	                  <span style={{ fontWeight: 600 }}>邮箱生成规则:</span>
	                  <input type="text" placeholder="固定前缀(可选)" value={mailboxEmailCfg.prefix} onChange={(e) => setMailboxEmailCfg({ ...mailboxEmailCfg, prefix: e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14) })} style={{ width: 130 }} disabled={busy || mailboxRegistering} title="固定前缀，拼接在随机部分之前" />
	                  <span>+</span>
	                  <label style={{ display: 'flex', alignItems: 'center', gap: 3 }} title="随机部分最短长度">
	                    <span>长度</span>
	                    <input type="number" min={1} max={20} value={mailboxEmailCfg.min} onChange={(e) => { const v = Math.max(1, Math.min(20, Number(e.target.value) || 1)); setMailboxEmailCfg({ ...mailboxEmailCfg, min: v, max: Math.max(v, mailboxEmailCfg.max) }); }} style={{ width: 56, textAlign: 'center' }} disabled={busy || mailboxRegistering} />
	                    <span>-</span>
	                    <input type="number" min={1} max={20} value={mailboxEmailCfg.max} onChange={(e) => { const v = Math.max(mailboxEmailCfg.min, Math.min(20, Number(e.target.value) || 1)); setMailboxEmailCfg({ ...mailboxEmailCfg, max: v }); }} style={{ width: 56, textAlign: 'center' }} disabled={busy || mailboxRegistering} />
	                  </label>
	                  <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
	                    <input type="checkbox" checked={mailboxEmailCfg.upper} onChange={(e) => setMailboxEmailCfg({ ...mailboxEmailCfg, upper: e.target.checked })} disabled={busy || mailboxRegistering} /> A-Z
	                  </label>
	                  <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
	                    <input type="checkbox" checked={mailboxEmailCfg.lower} onChange={(e) => setMailboxEmailCfg({ ...mailboxEmailCfg, lower: e.target.checked })} disabled={busy || mailboxRegistering} /> a-z
	                  </label>
	                  <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
	                    <input type="checkbox" checked={mailboxEmailCfg.digit} onChange={(e) => setMailboxEmailCfg({ ...mailboxEmailCfg, digit: e.target.checked })} disabled={busy || mailboxRegistering} /> 0-9
	                  </label>
	                  <select value={mailboxEmailSuffix} onChange={(e) => setMailboxEmailSuffix(e.target.value)} disabled={busy || mailboxRegistering} style={{ width: 130 }}>
	                    <option value="@outlook.com">@outlook.com</option>
	                    <option value="@hotmail.com">@hotmail.com</option>
	                  </select>
	                  <span style={{ opacity: 0.6 }}>示例: {mailboxEmailCfg.prefix || ''}{'x'.repeat(mailboxEmailCfg.min)}{mailboxEmailCfg.min < mailboxEmailCfg.max ? '...' : ''}{mailboxEmailSuffix}</span>
	                </div>
	                {mailboxRegisterProgress.running && (
	                  <div style={{ padding: '8px 16px', background: 'var(--surface-1, #f6f8fa)', borderBottom: '1px solid var(--border, #e1e4e8)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
	                    <strong>{mailboxRegisterProgress.continuous ? '持续注册:' : '批量进度:'}</strong>
	                    <span>{mailboxRegisterProgress.continuous ? `已完成 ${mailboxRegisterProgress.done}` : `${mailboxRegisterProgress.done} / ${mailboxRegisterProgress.total}`}</span>
	                    {!mailboxRegisterProgress.continuous && (
	                      <div style={{ flex: 1, height: 6, background: '#e1e4e8', borderRadius: 3, overflow: 'hidden' }}>
	                        <div style={{ width: `${mailboxRegisterProgress.total > 0 ? (mailboxRegisterProgress.done / mailboxRegisterProgress.total) * 100 : 0}%`, height: '100%', background: '#2ea44f', borderRadius: 3, transition: 'width 0.3s' }} />
	                      </div>
	                    )}
	                    {!mailboxRegisterProgress.continuous && <span style={{ opacity: 0.7 }}>剩余 {mailboxRegisterProgress.remaining}</span>}
	                    {mailboxRegisterProgress.email_suffix && <span style={{ opacity: 0.7, marginLeft: 8 }}>域名: {mailboxRegisterProgress.email_suffix}</span>}
	                  </div>
	                )}
	                <div className="mailboxRegisterBody">
	                  <MailboxStatusStrip mailboxes={mailboxes} />
	                  <div className="sectionTitle">
	                    <h3>邮箱注册 Job</h3>
	                    <button className="secondaryButton" onClick={() => openView('jobs')}>
	                      <ListChecks size={14} /> 全部工作流
	                    </button>
	                  </div>
	                  <JobTable jobs={mailboxRegisterJobs} selected={selectedJob?.job_id} busy={busy} lang={lang} onSelect={selectJob} onRetry={retryJob} />
	                  {trafficStats.total_registrations > 0 && (
	                    <div style={{ padding: '10px 16px', background: 'var(--surface-1, #f6f8fa)', borderTop: '1px solid var(--border, #e1e4e8)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
	                      <span style={{ fontWeight: 600 }}>注册统计:</span>
	                      <span>总计 <strong>{trafficStats.total_registrations}</strong> 次</span>
	                      <span style={{ color: '#2ea44f' }}>成功 <strong>{trafficStats.success_registrations}</strong></span>
	                      <span style={{ color: '#d32f2f' }}>失败 <strong>{trafficStats.failed_registrations}</strong></span>
	                      <span>成功率 <strong>{trafficStats.total_registrations > 0 ? ((trafficStats.success_registrations / trafficStats.total_registrations) * 100).toFixed(1) : 0}%</strong></span>
	                      <span style={{ marginLeft: 'auto', fontWeight: 600 }}>流量: <strong>{trafficStats.total_traffic_mb.toFixed(2)} MB</strong></span>
	                      {trafficStats.success_registrations > 0 && <span style={{ opacity: 0.7 }}>均 {(trafficStats.total_traffic_mb / trafficStats.success_registrations).toFixed(2)} MB/次</span>}
	                    </div>
	                  )}
	                </div>
	              </div>
	            </section>
	          )}

	          {activeView === 'otp' && (
            <section className="workspace otpWorkspace">
              <div className="panel otpPanel">
                <PanelHeader title="邮箱接码" icon={<MessageSquare size={16} />} />
                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input type="text" list="otpEmailList" value={otpEmail} onChange={(e) => setOtpEmail(e.target.value)} placeholder="输入或选择邮箱..." style={{ flex: 1, minWidth: 200 }} />
                    <datalist id="otpEmailList">
                      {mailboxes.filter((m) => m.refresh_token).map((m) => (
                        <option key={m.email_address} value={m.email_address} />
                      ))}
                    </datalist>
                    <input type="text" placeholder="关键词 (如 OTP、验证码)" value={otpKeyword} onChange={(e) => setOtpKeyword(e.target.value)} style={{ width: 180 }} />
                    <input type="number" min={10} max={600} value={otpTimeout} onChange={(e) => setOtpTimeout(Math.max(10, Math.min(600, Number(e.target.value) || 120)))} style={{ width: 70, textAlign: 'center' }} title="超时秒数" />
                    <button className="primaryButton" onClick={waitForOTP} disabled={otpWaiting || !otpEmail}>
                      {otpWaiting ? '等待中...' : '开始接码'}
                    </button>
                  </div>
                  {otpResult && (
                    <div style={{ padding: 12, borderRadius: 8, background: otpResult.found ? 'var(--ok-bg, #e6ffed)' : 'var(--err-bg, #fff0f0)', border: `1px solid ${otpResult.found ? '#34d058' : '#f44'}` }}>
                      <strong>{otpResult.found ? '✓ 验证码' : '✗ 未收到'}</strong>
                      {otpResult.found && <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'monospace', marginLeft: 12 }}>{otpResult.code}</span>}
                      <span style={{ float: 'right', opacity: 0.6, fontSize: 13 }}>{otpResult.time}</span>
                    </div>
                  )}
                  {otpHistory.length > 0 && (
                    <div>
                      <h3 style={{ margin: '8px 0' }}>历史记录</h3>
                      <div className="tableWrap">
                        <table>
                          <thead><tr><th>邮箱</th><th>关键词</th><th>验证码</th><th>状态</th><th>时间</th></tr></thead>
                          <tbody>
                            {otpHistory.map((h, i) => (
                              <tr key={i}>
                                <td className="mono">{h.email}</td>
                                <td>{h.keyword || '-'}</td>
                                <td className="mono" style={{ fontWeight: 700 }}>{h.code || '-'}</td>
                                <td>{h.found ? '✓' : '✗'}</td>
                                <td className="mono">{h.time}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 8, padding: 16, background: 'var(--surface-1, #f6f8fa)', borderRadius: 8, fontSize: 13, lineHeight: 1.7 }}>
                    <strong style={{ fontSize: 14 }}>外部 API 调用方式</strong>
                    <p style={{ margin: '8px 0 4px', opacity: 0.7 }}>基础地址: <code>{location.origin}</code></p>
                    <hr style={{ border: 'none', borderTop: '1px solid var(--border, #e1e4e8)', margin: '8px 0' }} />

                    <strong>1. 获取邮箱列表</strong>
                    <code style={{ display: 'block', whiteSpace: 'pre-wrap', margin: '4px 0 8px', padding: 8, background: '#fff', borderRadius: 4, border: '1px solid #e1e4e8' }}>{`GET ${location.origin}/api/mailboxes?status=AVAILABLE&limit=200`}</code>
                    <span style={{ opacity: 0.7 }}>返回:</span>
                    <code style={{ display: 'block', whiteSpace: 'pre-wrap', margin: '4px 0 12px', padding: 8, background: '#fff', borderRadius: 4, border: '1px solid #e1e4e8' }}>{`[
  {"email_address": "xxx@outlook.com", "status": "AVAILABLE", "refresh_token": "...", ...},
  ...
]`}</code>

                    <strong>2. 等待验证码（长轮询）</strong>
                    <code style={{ display: 'block', whiteSpace: 'pre-wrap', margin: '4px 0 8px', padding: 8, background: '#fff', borderRadius: 4, border: '1px solid #e1e4e8' }}>{`POST ${location.origin}/api/mailboxes/wait-otp
Content-Type: application/json

{"email_address": "xxx@outlook.com", "subject_keyword": "验证码", "timeout_seconds": 120}`}</code>
                    <span style={{ opacity: 0.7 }}>返回:</span>
                    <code style={{ display: 'block', whiteSpace: 'pre-wrap', margin: '4px 0 12px', padding: 8, background: '#fff', borderRadius: 4, border: '1px solid #e1e4e8' }}>{`{"found": true, "content_extracted": "123456"}`}</code>

                    <strong>3. 批量注册控制</strong>
                    <code style={{ display: 'block', whiteSpace: 'pre-wrap', margin: '4px 0 8px', padding: 8, background: '#fff', borderRadius: 4, border: '1px solid #e1e4e8' }}>{`// 查询进度
GET ${location.origin}/api/mailboxes/register

// 启动批量注册（count 个）
POST ${location.origin}/api/mailboxes/register
{"count": 10}

// 启动持续注册
POST ${location.origin}/api/mailboxes/register
{"continuous": true}

// 取消注册
POST ${location.origin}/api/mailboxes/register
{"cancel": true}`}</code>
                    <span style={{ opacity: 0.7 }}>查询返回:</span>
                    <code style={{ display: 'block', whiteSpace: 'pre-wrap', margin: '4px 0', padding: 8, background: '#fff', borderRadius: 4, border: '1px solid #e1e4e8' }}>{`{"running": true, "total": 10, "done": 3, "remaining": 7, "continuous": false}`}</code>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeView === 'jobs' && (
            <section className="workspace jobsWorkspace">
              <div className="panel jobsPanel">
                <PanelHeader title="工作流" icon={<Activity size={16} />}>
                  <div className="headerControls">
                    <button className="dangerButton" onClick={() => { if (confirm('确定删除所有失败的工作流记录？')) { bulkDeleteJobs('FAILED'); bulkDeleteJobs('FAILED_RETRYABLE'); } }} disabled={busy} title="删除所有失败工作流">
                      <Trash2 size={16} /> 清理失败记录
                    </button>
                    <select value={jobStatus} onChange={(e) => setJobStatus(e.target.value)}>
                      {jobStatusOptions.map((s) => <option key={s} value={s}>{s ? tStatus(s, lang) : '全部状态'}</option>)}
                    </select>
                  </div>
                </PanelHeader>
                <JobTable jobs={jobs} selected={selectedJob?.job_id} busy={busy} lang={lang} onSelect={selectJob} onRetry={retryJob} />
              </div>
            </section>
          )}
        </div>
      </section>

      <DetailDrawer open={!!selectedAccount} title="账号详情" onClose={closeDetails}>
        {selectedAccount && (
          <AccountDetails
            account={selectedAccount}
            showSecrets={showSecrets}
            busy={busy}
            onSessionSave={(account, sessionToken) => updateAccountAuth(account, { session_token: sessionToken })}
            onAccessSave={(account, accessToken) => updateAccountAuth(account, { access_token: accessToken })}
            onProbePlusTrial={(account) => runAccountWorkflow('资格探测', '/api/workflows/probe-plus-trial', account)}
          />
        )}
      </DetailDrawer>

      <DetailDrawer open={!!selectedJob} title="工作流详情" onClose={closeDetails}>
        {selectedJob && (
          <JobDetails
            job={selectedJob}
            busy={busy}
            lang={lang}
            onJobRetry={retryJob}
            onOtpSubmit={submitJobOtp}
          />
        )}
      </DetailDrawer>

      <DetailDrawer open={!!selectedMailbox} title="邮箱详情" onClose={closeDetails}>
        {selectedMailbox && (
          <MailboxDetails mailbox={selectedMailbox} showSecrets={showSecrets} lang={lang} onDelete={deleteMailbox} />
        )}
      </DetailDrawer>
    </main>
  );
}

function NavItem({ active, icon, label, count, onClick }: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className={`navItem ${active ? 'active' : ''}`} onClick={onClick}>
      <span>{icon}</span>
      <strong>{label}</strong>
      {count != null && <em>{count}</em>}
    </button>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="metric">
      <span>{icon}</span>
      <div>
        <strong>{value}</strong>
        <p>{label}</p>
      </div>
    </div>
  );
}

function PanelHeader({ title, icon, children }: { title: string; icon: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="panelHeader">
      <div><span>{icon}</span>{title}</div>
      {children}
    </div>
  );
}

function DetailDrawer({ open, title, onClose, children }: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawerLayer open">
      <button className="drawerBackdrop" onClick={onClose} aria-label="关闭详情" />
      <aside className="detailDrawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawerHeader">
          <div><Activity size={16} />{title}</div>
          <button className="iconButton" title="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

function AccountDetails({ account, showSecrets, busy, onSessionSave, onAccessSave, onProbePlusTrial }: {
  account: Account;
  showSecrets: boolean;
  busy: boolean;
  onSessionSave: (account: Account, sessionToken: string) => Promise<void>;
  onAccessSave: (account: Account, accessToken: string) => Promise<void>;
  onProbePlusTrial: (account: Account) => void;
}) {
  return (
    <div className="details">
      <section>
        <div className="sectionTitle">
          <h3>账号</h3>
          <button disabled={busy || !canProbePlusTrial(account)} onClick={() => onProbePlusTrial(account)}>
            <Search size={14} /> 探测资格
          </button>
        </div>
        <KV label="ID" value={account.account_id} mono />
        <KV label="Status" value={account.status || '-'} />
        <KV label="试用资格" value={trialText(account.plus_trial_eligible)} />
        <KV label="Email" value={account.email} />
        <KV label="Password" value={showSecrets ? account.password : mask(account.password)} mono />
        <TokenEditor label="Session" field="session_token" account={account} showSecrets={showSecrets} onSave={onSessionSave} />
        <TokenEditor label="Access" field="access_token" account={account} showSecrets={showSecrets} onSave={onAccessSave} />
        <KV label="Created" value={formatUnix(account.created_at)} />
        <KV label="Updated" value={formatUnix(account.updated_at)} />
        <KV label="Error" value={account.error_message || '-'} />
      </section>
    </div>
  );
}

function JobDetails({ job, busy, lang, onJobRetry, onOtpSubmit }: {
  job: Job;
  busy: boolean;
  lang: Lang;
  onJobRetry: (job: Job) => void;
  onOtpSubmit: (job: Job, otp: string) => Promise<void>;
}) {
  return (
    <div className="details">
      <section>
        <div className="sectionTitle">
          <h3>工作流</h3>
          {canRetryJob(job) && (
            <button disabled={busy} onClick={() => onJobRetry(job)}>
              <RefreshCcw size={14} /> 重试
            </button>
          )}
        </div>
        <KV label="Job" value={job.job_id} mono />
        <KV label={lang === 'zh' ? '动作' : 'Action'} value={tAction(job.action, lang)} />
        <KV label={lang === 'zh' ? '状态' : 'Status'} value={tStatus(job.status, lang)} />
        <KV label={lang === 'zh' ? '错误' : 'Error'} value={tError(job.error_message, lang) || '-'} />
        {canSubmitOtp(job) && <OtpSubmitter job={job} onSubmit={onOtpSubmit} />}
        <div className="timeline">
          {(job.steps || []).map((step) => (
            <div className="step" key={step.step_name}>
              <div>
                <strong>{tStep(step.step_name, lang)}</strong>
                <StatusBadge status={step.status} retryable={step.retryable} lang={lang} />
              </div>
              {step.error_message && <p>{tError(step.error_message, lang)}</p>}
              {step.result_json && <pre>{formatJSON(step.result_json)}</pre>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function OtpSubmitter({ job, onSubmit }: {
  job: Job;
  onSubmit: (job: Job, otp: string) => Promise<void>;
}) {
  const [otp, setOtp] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const value = otp.trim();
    if (!value) return;
    setSubmitting(true);
    try {
      await onSubmit(job, value);
      setOtp('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="otpSubmitter">
      <span><KeyRound size={14} /> 注册 OTP</span>
      <div>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="验证码"
          value={otp}
          onChange={(event) => setOtp(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit();
          }}
        />
        <button className="primaryButton" disabled={submitting || !otp.trim()} onClick={() => void submit()}>
          <KeyRound size={14} /> 提交
        </button>
      </div>
    </div>
  );
}

function AccountTable({ accounts, selected, showSecrets, runningAccountIds, busy, onSelect, onRegister, onActivate, onProbePlusTrial, onRegisterActivate, onDelete }: {
  accounts: Account[];
  selected?: string;
  showSecrets: boolean;
  runningAccountIds: Set<string>;
  busy: boolean;
  onSelect: (a: Account) => void;
  onRegister: (a: Account) => void;
  onActivate: (a: Account) => void;
  onProbePlusTrial: (a: Account) => void;
  onRegisterActivate: (a: Account) => void;
  onDelete: (a: Account) => void;
}) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>密码</th>
            <th>状态</th>
            <th>试用</th>
            <th>Session</th>
            <th>Access</th>
            <th>更新</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const accountBusy = runningAccountIds.has(account.account_id);
            return (
              <tr key={account.account_id} className={selected === account.account_id ? 'selected' : ''} onClick={() => onSelect(account)}>
                <td>
                  <div className="cellStack">
                    <span>{showSecrets ? account.email : mask(account.email)}</span>
                    <small className="mono">{short(account.account_id)}</small>
                  </div>
                </td>
                <td className="secret">{showSecrets ? account.password : mask(account.password)}</td>
                <td><StatusBadge status={account.status} /></td>
                <td><TrialBadge eligible={account.plus_trial_eligible} /></td>
                <td className="mono">{showSecrets ? short(account.session_token, 18) : mask(account.session_token)}</td>
                <td className="mono">{showSecrets ? short(account.access_token, 18) : mask(account.access_token)}</td>
                <td>{formatUnix(account.updated_at)}</td>
                <td>
                  <div className="rowActions" onClick={(event) => event.stopPropagation()}>
                    {accountBusy ? (
                      <span className="busyLabel">进行中</span>
                    ) : (
                      <>
                        {canRegister(account) && <button title="注册" disabled={busy} onClick={() => onRegister(account)}><Play size={14} /></button>}
                        {canActivate(account) && <button title="激活" disabled={busy} onClick={() => onActivate(account)}><Zap size={14} /></button>}
                        {canProbePlusTrial(account) && <button title="探测 Plus 试用资格" disabled={busy} onClick={() => onProbePlusTrial(account)}><Search size={14} /></button>}
                        {canRegister(account) && <button title="注册并激活" disabled={busy} onClick={() => onRegisterActivate(account)}><ShieldCheck size={14} /></button>}
                        <button className="dangerButton" title="删除账号" disabled={busy} onClick={() => onDelete(account)}><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function JobTable({ jobs, selected, busy, lang, onSelect, onRetry }: {
  jobs: Job[];
  selected?: string;
  busy: boolean;
  lang: Lang;
  onSelect: (j: Job) => void;
  onRetry: (j: Job) => void;
}) {
  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr><th>Job</th><th>动作</th><th>状态</th><th>重试</th><th>流量</th><th>完成时间</th><th>耗时</th><th>步骤</th><th>操作</th></tr>
        </thead>
        <tbody>
          {jobs.map((job) => {
            let trafficMB = '';
            try { const r = JSON.parse(job.result_json || '{}'); if (r.traffic_bytes > 0) trafficMB = (r.traffic_bytes / 1048576).toFixed(2) + ' MB'; } catch {}
            return (
            <tr key={job.job_id} className={selected === job.job_id ? 'selected' : ''} onClick={() => onSelect(job)}>
              <td className="mono">{short(job.job_id)}</td>
              <td>{tAction(job.action, lang)}</td>
              <td><StatusBadge status={job.status} retryable={job.retryable} lang={lang} /></td>
              <td className="mono">{job.retry_count || 0}</td>
              <td className="mono">{trafficMB || '-'}</td>
              <td className="mono">{formatBeijingTime(job.updated_at, job.status)}</td>
              <td className="mono">{formatDuration(job.created_at, job.updated_at, job.status)}</td>
              <td>{tStep(job.last_step, lang) || '-'}</td>
              <td>
                <div className="rowActions" onClick={(event) => event.stopPropagation()}>
                  {canRetryJob(job) ? (
                    <button title="按同参数重试" disabled={busy} onClick={() => onRetry(job)}>
                      <RefreshCcw size={14} />
                    </button>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MailboxPanel({ mailboxes, selected, busy, showSecrets, oauthing, onSelect, onOAuth, onDone, onError }: {
  mailboxes: Mailbox[];
  selected?: string;
  busy: boolean;
  showSecrets: boolean;
  oauthing: string;
  onSelect: (mailbox: Mailbox) => void;
  onOAuth: (emailAddress?: string) => Promise<void>;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({ email: '', password: '', refresh_token: '', access_token: '', status: 'AVAILABLE' });
  const [working, setWorking] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function saveMailbox() {
    setWorking(true);
    try {
      const payload = { ...form, status: form.status || 'AVAILABLE' };
      const resp = await api<Mailbox>('/api/mailboxes', { method: 'POST', body: JSON.stringify(payload) });
      setForm({ email: '', password: '', refresh_token: '', access_token: '', status: 'AVAILABLE' });
      onDone(`邮箱已入池: ${resp.email_address}`);
    } catch (err) {
      onError(errorText(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <MailboxStatusStrip mailboxes={mailboxes} />
      <div className="mailboxForm">
        <input placeholder="邮箱" value={form.email} onChange={(e) => update('email', e.target.value)} />
        <input placeholder="邮箱密码，可空" type="password" value={form.password} onChange={(e) => update('password', e.target.value)} />
        <input placeholder="Refresh token，可空" type="password" value={form.refresh_token} onChange={(e) => update('refresh_token', e.target.value)} />
        <input placeholder="Access token，可空" type="password" value={form.access_token} onChange={(e) => update('access_token', e.target.value)} />
        <select value={form.status} onChange={(e) => update('status', e.target.value)}>
          {mailboxStatusOptions.filter(Boolean).map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={saveMailbox} disabled={busy || working || !form.email.trim()}><Plus size={15} /> 入池</button>
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr><th>邮箱</th><th>密码</th><th>类型</th><th>状态</th><th>失败</th><th>Token</th><th>更新</th><th>错误</th><th>操作</th></tr>
          </thead>
          <tbody>
            {mailboxes.map((mailbox) => {
              const isOAuthing = oauthing === mailbox.email_address || oauthing === '*';
              const canOAuth = mailbox.is_primary && !!mailbox.password;
              return (
                <tr key={mailbox.email_address} className={selected === mailbox.email_address ? 'selected' : ''} onClick={() => onSelect(mailbox)}>
                  <td>
                    <div className="cellStack" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); copyText(mailbox.email_address); onDone(`已复制邮箱: ${mailbox.email_address}`); }}>
                      <span>{showSecrets ? mailbox.email_address : maskEmail(mailbox.email_address)}</span>
                      <small>{mailbox.primary_email || '-'}</small>
                    </div>
                  </td>
                  <td>
                    {mailbox.password ? (
                      <span className="mono" style={{ fontSize: 12, cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); copyText(mailbox.password); onDone(`已复制密码: ${mailbox.password}`); }}>
                        {showSecrets ? mailbox.password : '••••••'}
                      </span>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                  <td>{mailbox.is_primary ? '主邮箱' : 'Alias'}</td>
                  <td><StatusBadge status={mailbox.status} /></td>
                  <td className="mono">{mailbox.fail_count || 0}</td>
                  <td><TokenBadge mailbox={mailbox} /></td>
                  <td>{formatUnix(mailbox.updated_at)}</td>
                  <td title={mailbox.last_error}>{compactToast(mailbox.last_error || '-')}</td>
                  <td>
                    <div className="rowActions" onClick={(event) => event.stopPropagation()}>
                      {canOAuth ? (
                        <button title="启动 OAuth 流程" disabled={busy || !!oauthing} onClick={() => onOAuth(mailbox.email_address)}>
                          <KeyRound size={14} /> {isOAuthing ? '提交中' : 'OAuth'}
                        </button>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function MailboxOAuthTable({ mailboxes, busy, showSecrets, oauthing, onOAuth }: {
  mailboxes: Mailbox[];
  busy: boolean;
  showSecrets: boolean;
  oauthing: string;
  onOAuth: (emailAddress?: string) => Promise<void>;
}) {
  return (
    <div className="tableWrap oauthTableWrap">
      <table>
        <thead>
          <tr><th>邮箱</th><th>状态</th><th>Token</th><th>更新</th><th>操作</th></tr>
        </thead>
        <tbody>
          {mailboxes.map((mailbox) => {
            const isOAuthing = oauthing === mailbox.email_address || oauthing === '*';
            return (
              <tr key={mailbox.email_address}>
                <td>
                  <div className="cellStack">
                    <span>{showSecrets ? mailbox.email_address : maskEmail(mailbox.email_address)}</span>
                    <small>{mailbox.refresh_token ? '已授权' : '缺 OAuth'}</small>
                  </div>
                </td>
                <td><StatusBadge status={mailbox.status} /></td>
                <td><TokenBadge mailbox={mailbox} /></td>
                <td>{formatUnix(mailbox.updated_at)}</td>
                <td>
                  <button
                    className="rowButton"
                    title="执行 Microsoft OAuth"
                    disabled={busy || !!oauthing}
                    onClick={() => onOAuth(mailbox.email_address)}
                  >
                    <KeyRound size={14} /> {isOAuthing ? '处理中' : 'OAuth'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MailboxStatusStrip({ mailboxes }: { mailboxes: Mailbox[] }) {
  const items = [
    ['AVAILABLE', '可用'],
    ['ASSIGNED', '已分配'],
    ['REGISTERED', '已注册'],
    ['OAUTH_PENDING', '待 OAuth'],
    ['AUTH_FAILED', '认证失败'],
    ['BLOCKED', '已封禁']
  ];
  return (
    <div className="mailboxStatusStrip">
      {items.map(([status, label]) => (
        <div key={status}>
          <strong>{mailboxes.filter((mailbox) => mailbox.status === status).length}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function MailboxDetails({ mailbox, showSecrets, lang, onDelete }: {
  mailbox: Mailbox;
  showSecrets: boolean;
  lang: Lang;
  onDelete: (email: string) => void;
}) {
  return (
    <div className="details">
      <section>
        <div className="sectionTitle">
          <h3>邮箱</h3>
          <button className="dangerButton" onClick={() => { if (confirm(`确定删除邮箱 ${mailbox.email_address} 及其别名？`)) onDelete(mailbox.email_address); }} title="删除邮箱">
            <Trash2 size={14} /> 删除
          </button>
        </div>
        <KV label="Email" value={showSecrets ? mailbox.email_address : maskEmail(mailbox.email_address)} />
        <KV label={lang === 'zh' ? '密码' : 'Password'} value={showSecrets ? mailbox.password : mask(mailbox.password)} mono />
        <KV label={lang === 'zh' ? '状态' : 'Status'} value={tStatus(mailbox.status, lang) || '-'} />
        <KV label={lang === 'zh' ? '类型' : 'Type'} value={mailbox.is_primary ? '主邮箱' : 'Alias'} />
        <KV label={lang === 'zh' ? '主邮箱' : 'Primary'} value={mailbox.primary_email || '-'} />
        <KV label="Refresh Token" value={showSecrets ? mailbox.refresh_token : mask(mailbox.refresh_token)} mono />
        <KV label="Access Token" value={showSecrets ? mailbox.access_token : mask(mailbox.access_token)} mono />
        <KV label={lang === 'zh' ? '创建时间' : 'Created'} value={formatUnix(mailbox.created_at)} />
        <KV label={lang === 'zh' ? '更新时间' : 'Updated'} value={formatUnix(mailbox.updated_at)} />
        <KV label={lang === 'zh' ? '错误' : 'Error'} value={tError(mailbox.last_error, lang) || '-'} />
      </section>
    </div>
  );
}

function CreateAccountForm({ onDone, onError }: {
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [form, setForm] = useState({
    email: '',
    password: ''
  });
  const [working, setWorking] = useState('');

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function run(label: string, path: string, payload: unknown) {
    setWorking(label);
    try {
      const resp = await api<any>(path, { method: 'POST', body: JSON.stringify(payload) });
      if (resp.error_message) {
        onError(resp.error_message);
      } else {
        onDone(`${label} 已提交: ${resp.job_id || resp.account_id || 'ok'}`);
      }
    } catch (err) {
      onError(errorText(err));
    } finally {
      setWorking('');
    }
  }

  return (
    <div className="createAccount">
      <div className="formGrid">
        <input placeholder="邮箱，可空" value={form.email} onChange={(e) => update('email', e.target.value)} />
        <input placeholder="密码，可空" value={form.password} onChange={(e) => update('password', e.target.value)} />
      </div>
      <div className="buttonRow">
        <button onClick={() => run('创建账号', '/api/accounts', form)} disabled={!!working}><Plus size={15} /> 创建账号</button>
      </div>
      {working && <p className="hint">正在执行：{working}</p>}
    </div>
  );
}

function TokenEditor({ label, field, account, showSecrets, onSave }: {
  label: string;
  field: 'session_token' | 'access_token';
  account: Account;
  showSecrets: boolean;
  onSave: (account: Account, token: string) => Promise<void>;
}) {
  const current = account[field] || '';
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(account[field] || '');
  }, [account.account_id, account.session_token, account.access_token, field]);

  async function save() {
    setSaving(true);
    try {
      await onSave(account, value.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="editLine">
      <span>{label}</span>
      <input
        className="mono"
        type={showSecrets ? 'text' : 'password'}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={`${label.toLowerCase()} token`}
      />
      <button className="copyButton" title={`复制 ${label}`} disabled={!value.trim()} onClick={() => copyText(value)}>
        <Copy size={14} />
      </button>
      <button onClick={save} disabled={saving || value.trim() === current}>
        <Save size={14} /> 保存
      </button>
    </div>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <button className={mono ? 'mono valueButton' : 'valueButton'} onClick={() => copyText(value)}>{value || '-'}</button>
      <button className="copyButton" title={`复制 ${label}`} disabled={!value} onClick={() => copyText(value)}>
        <Copy size={14} />
      </button>
    </div>
  );
}

function StatusBadge({ status, retryable, lang = 'en' }: { status: string; retryable?: boolean; lang?: Lang }) {
  const cls = status.includes('FAILED') || status.includes('EXISTS') || status === 'BLOCKED' ? 'bad' : status === 'SUCCEEDED' || status === 'ACTIVATED' || status === 'REGISTERED' ? 'good' : 'mid';
  return <span className={`badge ${cls}`}>{tStatus(status, lang) || '-'}{retryable ? (lang === 'zh' ? ' / 可重试' : ' / retry') : ''}</span>;
}

function TrialBadge({ eligible }: { eligible?: boolean }) {
  if (eligible === true) return <span className="badge good">0元</span>;
  if (eligible === false) return <span className="badge bad">非0元</span>;
  return <span className="badge mid">未知</span>;
}

function TokenBadge({ mailbox }: { mailbox: Mailbox }) {
  if (mailbox.refresh_token) return <span className="badge good">Refresh</span>;
  if (mailbox.access_token) return <span className="badge mid">Access</span>;
  return <span className="badge bad">None</span>;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || resp.statusText);
  return data as T;
}

function canRegister(account: Account) {
  return account.status !== 'EMAIL_ALREADY_EXISTS' && !hasRegisteredSession(account);
}

function canActivate(account: Account) {
  return account.status !== 'ACTIVATED' && (!!account.session_token || !!account.access_token);
}

function canProbePlusTrial(account: Account) {
  return account.status !== 'ACTIVATED' && !!account.session_token;
}

function hasRegisteredSession(account: Account) {
  return account.status === 'REGISTERED' || account.status === 'ACTIVATED' || !!account.session_token || !!account.access_token;
}

function canRetryJob(job: Job) {
  return job.retryable && job.status.startsWith('FAILED');
}

function canSubmitOtp(job: Job) {
  return job.status === 'RUNNING' && (job.action === 'REGISTER' || job.action === 'REGISTER_AND_ACTIVATE');
}

function short(value: string, size = 8) {
  return value ? `${value.slice(0, size)}…` : '-';
}

function mask(value: string) {
  return value ? '••••••••' : '-';
}

function maskEmail(value: string) {
  if (!value) return '-';
  const [local, domain] = value.split('@');
  if (!local || !domain) return mask(value);
  return `${local.slice(0, 2)}***@${domain}`;
}

function formatUnix(value: number) {
  return value ? new Date(value * 1000).toLocaleString() : '-';
}

function formatBeijingTime(dateStr: string, status: string) {
  if (!dateStr || status === 'RUNNING' || status === 'CREATED') return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function formatDuration(createdAt: string, updatedAt: string, status: string) {
  if (!createdAt) return '-';
  const start = new Date(createdAt).getTime();
  if (isNaN(start)) return '-';
  const end = status === 'RUNNING' ? Date.now() : (updatedAt ? new Date(updatedAt).getTime() : Date.now());
  if (isNaN(end)) return '-';
  const ms = end - start;
  if (ms < 0) return '-';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m${remainSec > 0 ? remainSec + 's' : ''}`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h${remainMin > 0 ? remainMin + 'm' : ''}`;
}

function trialText(value?: boolean) {
  if (value === true) return '0元试用';
  if (value === false) return '非0元';
  return '未知';
}

function errorText(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function compactToast(value: string) {
  const text = String(value || '');
  return text.length > 150 ? `${text.slice(0, 150)}...` : text;
}

function formatJSON(value: string) {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function copyText(value: string) {
  if (!value) return;
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(value);
  } else {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

createRoot(document.getElementById('root')!).render(<App />);
