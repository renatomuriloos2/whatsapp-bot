import { Role } from "@/types/database";

export function RoleSelect({ defaultValue = "agente" }: { defaultValue?: Role }) {
  return (
    <div>
      <label className="label" htmlFor="role">
        Rol
      </label>
      <select id="role" name="role" defaultValue={defaultValue} className="input max-w-sm">
        <option value="agente">Agente — atiende conversaciones y carga conocimiento</option>
        <option value="admin">Administrador — además ve costos, configuración y usuarios</option>
      </select>
    </div>
  );
}
