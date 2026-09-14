import { NextResponse } from 'next/server';
import {
  countActiveAdmins,
  deleteUser,
  errorResponse,
  generateTempPassword,
  getUserById,
  logEvent,
  passwordPolicyError,
  requestMeta,
  requireRole,
  revokeUserSessions,
  setPassword,
  updateUser,
  type AppUser,
} from '@/lib/auth';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Edición de un usuario: nombre, rol, activo/inactivo, reseteo de clave.
 * Reglas: nadie se degrada ni se desactiva a sí mismo, y siempre queda al
 * menos un admin activo. Desactivar o resetear la clave cierra sus sesiones.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requireRole(request, 'admin');
  if (!auth.ok) return auth.res;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: 'Id inválido' }, { status: 400 });
    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });

    const body = await request.json().catch(() => null);
    const isSelf = id === auth.claims.uid;
    const patch: Partial<Pick<AppUser, 'name' | 'role' | 'is_active'>> = {};
    const changes: Record<string, unknown> = {};

    if (typeof body?.name === 'string') patch.name = body.name.trim().slice(0, 80);

    if (body?.role === 'admin' || body?.role === 'member') {
      if (body.role !== target.role) {
        if (isSelf) return NextResponse.json({ error: 'No podés cambiar tu propio rol' }, { status: 400 });
        if (target.role === 'admin' && target.is_active && (await countActiveAdmins(id)) === 0) {
          return NextResponse.json({ error: 'Tiene que quedar al menos un administrador activo' }, { status: 400 });
        }
        patch.role = body.role;
        changes.role = body.role;
      }
    }

    if (typeof body?.is_active === 'boolean' && body.is_active !== target.is_active) {
      if (isSelf) return NextResponse.json({ error: 'No podés desactivar tu propia cuenta' }, { status: 400 });
      if (!body.is_active && target.role === 'admin' && (await countActiveAdmins(id)) === 0) {
        return NextResponse.json({ error: 'Tiene que quedar al menos un administrador activo' }, { status: 400 });
      }
      patch.is_active = body.is_active;
      changes.is_active = body.is_active;
    }

    let tempPassword: string | null = null;
    if (body?.resetPassword) {
      const provided = typeof body?.password === 'string' && body.password.length > 0;
      const password: string = provided ? body.password : generateTempPassword();
      if (provided) {
        const policy = passwordPolicyError(password);
        if (policy) return NextResponse.json({ error: policy }, { status: 400 });
      }
      await setPassword(id, password, true);
      tempPassword = provided ? null : password;
      changes.passwordReset = true;
    }

    const user = Object.keys(patch).length ? await updateUser(id, patch) : await getUserById(id);

    let sessionsClosed = 0;
    if (patch.is_active === false || body?.resetPassword) {
      sessionsClosed = await revokeUserSessions(id, isSelf ? auth.claims.sid : undefined);
    }

    const meta = requestMeta(request);
    if (body?.resetPassword) {
      await logEvent('password_reset', { email: target.email, userId: id, actorId: auth.claims.uid, meta, detail: { by: auth.claims.email, sessionsClosed } });
    }
    if (Object.keys(changes).length && !(Object.keys(changes).length === 1 && changes.passwordReset)) {
      await logEvent('user_updated', { email: target.email, userId: id, actorId: auth.claims.uid, meta, detail: { ...changes, by: auth.claims.email, sessionsClosed } });
    }

    return NextResponse.json({ user, tempPassword, sessionsClosed });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Baja definitiva (arrastra sus sesiones). Ni a uno mismo ni al último admin. */
export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await requireRole(request, 'admin');
  if (!auth.ok) return auth.res;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: 'Id inválido' }, { status: 400 });
    if (id === auth.claims.uid) return NextResponse.json({ error: 'No podés borrar tu propia cuenta' }, { status: 400 });
    const target = await getUserById(id);
    if (!target) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    if (target.role === 'admin' && target.is_active && (await countActiveAdmins(id)) === 0) {
      return NextResponse.json({ error: 'Tiene que quedar al menos un administrador activo' }, { status: 400 });
    }

    await deleteUser(id);
    await logEvent('user_deleted', {
      email: target.email,
      userId: id,
      actorId: auth.claims.uid,
      meta: requestMeta(request),
      detail: { by: auth.claims.email, role: target.role },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    return errorResponse(e);
  }
}
