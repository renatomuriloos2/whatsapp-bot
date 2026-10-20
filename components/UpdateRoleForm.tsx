"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateUserRoleAction, ActionState } from "@/lib/actions/users";
import { RoleSelect } from "@/components/RoleSelect";
import { Role } from "@/types/database";

const initialState: ActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-secondary self-start">
      {pending ? "Guardando..." : "Guardar cambios"}
    </button>
  );
}

export function UpdateRoleForm({ userId, currentRole }: { userId: string; currentRole: Role }) {
  const action = updateUserRoleAction.bind(null, userId);
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <RoleSelect defaultValue={currentRole} />
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
