import { useState } from "react";
import { setToken } from "../api/client.js";
import { relay } from "../api/relay.js";
import { Banner, Button, Field } from "../components/ui.jsx";

export function SignIn({ expired, onSignedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await relay.login(email, password);
      setToken(token);
      onSignedIn();
    } catch (failure) {
      setError(failure.message);
      setPassword("");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-line bg-white p-6"
      >
        <div className="flex flex-col gap-1">
          <h1 className="text-[19px] font-bold tracking-tight text-accent">Relay</h1>
          <p className="text-sm text-muted">Sign in to continue.</p>
        </div>
        {expired && !error && <Banner>Your session ended. Sign in again.</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
        <Field
          label="Email"
          id="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          label="Password"
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button kind="primary" type="submit" disabled={busy || !email || !password}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
