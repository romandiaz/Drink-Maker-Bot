// System routines — operator-triggered actions that affect the backend process
// itself.
//
// Restart works in three environments:
//   * Pi under systemd  — the install-kiosk unit runs scripts/run-server.sh,
//                          which keeps node looping; our process.exit(0) just
//                          falls back into the wrapper loop. No self-respawn
//                          needed here, and trying would only race the wrapper
//                          for :3000.
//   * Pi run manually   — no wrapper; we spawn a detached `sh` that re-execs
//                          node after a brief delay, then exit.
//   * Windows dev box   — same idea via cmd.exe.
//
// We use $INVOCATION_ID (set by systemd on its child processes) to skip the
// self-respawn under systemd — both because the wrapper already handles it
// and because a detached child would land in the unit's cgroup and get killed
// when the parent exits anyway.
import { spawn } from "node:child_process";
import { sendJson } from "../http-util.js";
import { getState as getMachineState } from "../machine-state.js";

function selfRespawn() {
  if (process.env.INVOCATION_ID) return; // systemd will handle it
  const node = process.execPath;
  const script = process.argv[1];
  if (!script) return;
  // Brief sleep before the child binds so the parent has time to release the
  // listening port; otherwise the new instance races us for :3000 and EADDRINUSE.
  if (process.platform === "win32") {
    spawn(
      "cmd",
      ["/c", `timeout /t 2 /nobreak >nul & "${node}" "${script}"`],
      {
        detached: true,
        stdio: "ignore",
        cwd: process.cwd(),
        env: process.env,
        windowsHide: true,
      }
    ).unref();
  } else {
    spawn(
      "sh",
      ["-c", `sleep 1 && exec "${node}" "${script}"`],
      {
        detached: true,
        stdio: "ignore",
        cwd: process.cwd(),
        env: process.env,
      }
    ).unref();
  }
}

export async function systemRoutes(req, res, urlPath, ctx) {
  if (urlPath === "/api/system/restart" && req.method === "POST") {
    if (getMachineState().status !== "idle") {
      sendJson(res, 409, { error: "machine busy" });
      return true;
    }
    sendJson(res, 200, { ok: true });
    process.nextTick(() => {
      try {
        ctx.broadcast({ type: "SERVER_RESTART" });
      } catch {}
      // Schedule the respawn first, then exit. The shell command sleeps before
      // binding, so by the time the child opens :3000 we'll be long gone.
      selfRespawn();
      setTimeout(() => process.exit(0), 250);
    });
    return true;
  }

  return false;
}
