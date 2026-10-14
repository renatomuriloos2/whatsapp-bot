"use client";

import { useFormState, useFormStatus } from "react-dom";
import { setUserPasswordAction, ActionState } from "@/lib/actions/users";

const initialState: ActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary self-start">
      {pending ? "Guardando..." : "Guardar contraseña"}
    </button>
  );
}

export function SetPasswordForm({ userId }: { userId: string }) {
  const action = setUserPasswordAction.bind(null, userId);
  const [state, formAction] = useFormState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <label className="label" htmlFor="password">
          Nueva contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          className="input max-w-sm"
        />
      </div>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
