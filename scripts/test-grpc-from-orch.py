#!/usr/bin/env python3
"""Test gRPC call to outlook-register-service from orchestrator container."""
import grpc
from google.protobuf import descriptor_pb2

# Test raw gRPC call to the register service
channel = grpc.insecure_channel('outlook-register-service:50051')

# Check what services are available via reflection
try:
    from grpc_reflection.v1alpha import reflection_pb2, reflection_pb2_grpc
    stub = reflection_pb2_grpc.ServerReflectionStub(channel)
    print("Reflection available")
except ImportError:
    print("No grpc_reflection module")

# Manual unary call
method = '/mailboxregister.MailboxRegistrationService/RunMailboxRegistration'

# Build a minimal protobuf request (enabled=false, import_only=true)
# Field 1 (enabled) = false (default, omitted), Field 2 (import_only) = true = varint 1
import struct
request_bytes = b'\x10\x01'  # field 2, varint, value 1

try:
    response = channel.unary_unary(
        method,
        request_serializer=lambda x: x,
        response_deserializer=lambda x: x,
    )(request_bytes, timeout=10)
    print(f"SUCCESS: got {len(response)} bytes response")
except grpc.RpcError as e:
    print(f"GRPC ERROR: code={e.code()} details={e.details()}")
