// Single entry point for "I want to enter admin." Mounts the PIN modal and,
// on success, navigates to the admin screen. Used by every admin entry point
// (idle gear, idle 5-tap eyebrow, category gear, #admin hash) so PIN gating
// only lives in one place.

import { pinModal } from "./components/pin-modal.js";
import { navigate } from "./app.js";

let activeModal = null;

export function requestAdminAccess() {
  // Re-tapping a gear button while the modal is already up is a no-op rather
  // than stacking two modals.
  if (activeModal) return;
  const modal = pinModal({
    onDone: (ok) => {
      dismissAdminPrompt();
      if (ok) navigate("admin");
    },
  });
  activeModal = modal;
  document.body.appendChild(modal);
}

// Called on inactivity reset so a modal left up by a user who walked away
// doesn't survive the auto-return to idle.
export function dismissAdminPrompt() {
  if (!activeModal) return;
  activeModal.remove();
  activeModal = null;
}
