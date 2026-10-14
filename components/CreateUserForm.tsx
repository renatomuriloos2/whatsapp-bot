"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createUserAction, ActionState } from "@/lib/actions/users";
import { RoleSelect } from "@/components/RoleSelect";

const initialState: ActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Creando..." : "Crear usuario"}
    </button>
  );
}

export function CreateUserForm() {
  const [state, formAction] = useFormState(createUserAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <label className="label" htmlFor="email">
          Correo
        </label>
        <input id="email" name="email" type="email" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Contraseña
        </label>
        <input id="password" name="password" type="password" required minLength={8} className="input" />
      </div>
      <RoleSelect />
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
