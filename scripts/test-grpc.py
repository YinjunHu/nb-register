import grpc
import sys
sys.path.insert(0, '/app')
import mailbox_register_pb2
import mailbox_register_pb2_grpc

channel = grpc.insecure_channel('outlook-register-service:50051')
stub = mailbox_register_pb2_grpc.MailboxRegistrationServiceStub(channel)

try:
    # Use a short timeout just to test if method is recognized
    resp = stub.RunMailboxRegistration(
        mailbox_register_pb2.RunMailboxRegistrationRequest(enabled=False, import_only=True),
        timeout=10,
    )
    print(f"SUCCESS: success={resp.success} exit_code={resp.exit_code} error={resp.error_message} accounts={len(resp.accounts)}")
except grpc.RpcError as e:
    print(f"GRPC ERROR: code={e.code()} details={e.details()}")
except Exception as e:
    print(f"ERROR: {type(e).__name__}: {e}")
