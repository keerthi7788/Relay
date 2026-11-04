import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { getToken, onSignedOut } from "./api/client.js";
import { Layout } from "./components/Layout.jsx";
import { Approvals } from "./pages/Approvals.jsx";
import { NewWorkflow } from "./pages/NewWorkflow.jsx";
import { RunDetail } from "./pages/RunDetail.jsx";
import { Runs } from "./pages/Runs.jsx";
import { SignIn } from "./pages/SignIn.jsx";
import { Workflows } from "./pages/Workflows.jsx";
import { GuardrailsTab } from "./pages/workflow/GuardrailsTab.jsx";
import { StepsTab } from "./pages/workflow/StepsTab.jsx";
import { TriggerTab } from "./pages/workflow/TriggerTab.jsx";
import { WorkflowLayout } from "./pages/workflow/WorkflowLayout.jsx";

export function App() {
  const [signedIn, setSignedIn] = useState(Boolean(getToken()));
  const [expired, setExpired] = useState(false);

  useEffect(
    () =>
      onSignedOut((detail) => {
        setSignedIn(false);
        setExpired(detail.expired);
      }),
    [],
  );

  if (!signedIn) {
    return <SignIn expired={expired} onSignedIn={() => setSignedIn(true)} />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/workflows" replace />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="workflows/new" element={<NewWorkflow />} />
        <Route path="workflows/:id" element={<WorkflowLayout />}>
          <Route index element={<StepsTab />} />
          <Route path="trigger" element={<TriggerTab />} />
          <Route path="guardrails" element={<GuardrailsTab />} />
        </Route>
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:id" element={<RunDetail />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="*" element={<Navigate to="/workflows" replace />} />
      </Route>
    </Routes>
  );
}
