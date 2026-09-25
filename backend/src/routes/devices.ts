import { Router } from 'express';
import { authenticate, adminOnly, identity, validateId } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { audit, transaction } from '../services/security.js';
export const devicesRouter = Router();
devicesRouter.post('/:id/revoke',authenticate,adminOnly,validateId,async (req,res) => {
  const ctx=identity(res), deviceId=String(req.params.id);
  await transaction(async client => {
    const result=await client.query('UPDATE devices SET revoked_at=COALESCE(revoked_at,now()),updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING user_id',[deviceId,ctx.organizationId]);
    if (!result.rowCount) throw new HttpError(404,'Not found');
    await client.query('UPDATE sessions SET revoked_at=now(),updated_at=now() WHERE organization_id=$1 AND device_id=$2 AND revoked_at IS NULL',[ctx.organizationId,deviceId]);
    await audit(client,ctx.organizationId,'device.revoked',ctx.userId,ctx.deviceId,'device',deviceId);
  });
  res.sendStatus(204);
});
