/**
 * Unit tests for Socket.IO role-change disconnect helpers (no live server).
 * Usage: npx ts-node --transpile-only scripts/test-socket-role-disconnect.ts
 *
 * Limitation: does not spin up a real Socket.IO server; verifies room assignment
 * rules and disconnect-by-user selection used when Admin changes a role.
 */
import {
  filterSocketsOwnedByUser,
  roomsForAuthenticatedUser,
} from "../src/services/socket.service";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

function testAdminConnectRooms(): void {
  const rooms = roomsForAuthenticatedUser({
    id: "admin-1",
    role: "admin",
  });
  assert(rooms.includes("user:admin-1"), "A: admin joins user room");
  assert(rooms.includes("role:admin"), "A: admin joins admin room");
}

function testAgentConnectRooms(): void {
  const rooms = roomsForAuthenticatedUser({
    id: "agent-1",
    role: "agent",
  });
  assert(rooms.includes("user:agent-1"), "C: agent joins user room");
  assert(
    !rooms.includes("role:admin"),
    "C: agent does NOT join admin room after Admin→Agent reconnect"
  );
}

function testAgentToAdminRooms(): void {
  const rooms = roomsForAuthenticatedUser({
    id: "user-2",
    role: "admin",
  });
  assert(
    rooms.includes("role:admin"),
    "D: Agent→Admin reconnect assigns admin room"
  );
}

function testDisconnectOnlyTargetUser(): void {
  const sockets = [
    { socketId: "s1", userId: "user-a" },
    { socketId: "s2", userId: "user-a" },
    { socketId: "s3", userId: "user-b" },
    { socketId: "s4", userId: null },
  ];
  const selected = filterSocketsOwnedByUser(sockets, "user-a");
  assert(
    selected.length === 2 &&
      selected.includes("s1") &&
      selected.includes("s2"),
    "B: role change selects all sockets for target user"
  );
  assert(
    !selected.includes("s3") && !selected.includes("s4"),
    "E: changing user-a does not select unrelated sockets"
  );
}

function testEmptyTarget(): void {
  assert(
    filterSocketsOwnedByUser(
      [{ socketId: "s1", userId: "x" }],
      ""
    ).length === 0,
    "empty userId disconnects nobody"
  );
}

console.log("--- socket role-change disconnect tests ---");
testAdminConnectRooms();
testAgentConnectRooms();
testAgentToAdminRooms();
testDisconnectOnlyTargetUser();
testEmptyTarget();

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll socket role-disconnect tests passed.");
console.log(
  "Note: live Socket.IO disconnect is exercised via disconnectSocketsForUser in updateUser when role changes."
);
