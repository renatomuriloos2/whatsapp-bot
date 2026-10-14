"use client";

import { useFormState, useFormStatus } from "react-dom";
import { deleteUserAction, ActionState } from "@/lib/actions/users";

const initialState: ActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-secondary text-red-400">
      {pending ? "Eliminando..." : "Eliminar usuario"}
    </button>
  );
}

export function DeleteUserForm({ userId }: { userId: string }) {
  const action = deleteUserAction.bind(null, userId);
  const [state, formAction] = useFormState(action, initialState);

  return (
    <form action={formAction}>
      {state.error && <p className="mb-2 text-sm text-red-400">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
