import { NavLink, Outlet } from "react-router-dom";
import { signOut } from "../api/client.js";
import { relay } from "../api/relay.js";
import { usePolling } from "../hooks/usePolling.js";

const PENDING_REFRESH_MS = 5000;
const loadPending = () => relay.listApprovals({ status: "pending", limit: 200 });
const loadUser = () => relay.me();

const linkClass = ({ isActive }) =>
  `flex min-h-10 items-center rounded-md px-3 text-sm no-underline ${
    isActive ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-ground"
  }`;

export function Layout() {
  const { data: pending } = usePolling(loadPending, PENDING_REFRESH_MS);
  const { data: user } = usePolling(loadUser);
  const pendingCount = pending?.length ?? 0;

  return (
    <div className="flex min-h-screen flex-wrap">
      <nav
        aria-label="Main"
        className="flex flex-[1_0_200px] flex-col gap-1 border-r border-line bg-white px-3.5 py-5"
      >
        <div className="px-3 pb-4 text-[19px] font-bold tracking-tight text-accent">Relay</div>
        <NavLink to="/workflows" className={linkClass}>
          Workflows
        </NavLink>
        <NavLink to="/runs" className={linkClass}>
          Runs
        </NavLink>
        <NavLink to="/approvals" className={linkClass}>
          Approvals
          {pendingCount > 0 && (
            <span className="ml-auto rounded-full bg-warn-soft px-2 text-xs font-semibold text-warn">
              {pendingCount}
            </span>
          )}
        </NavLink>
        <div className="mt-auto flex flex-col gap-0.5 px-3">
          <span className="break-all text-xs text-muted">{user?.email}</span>
          <button
            type="button"
            onClick={() => signOut()}
            className="min-h-8 text-left text-xs text-accent underline"
          >
            Sign out
          </button>
        </div>
      </nav>
      <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 px-8 pb-10 pt-7">
        <Outlet />
      </main>
    </div>
  );
}
