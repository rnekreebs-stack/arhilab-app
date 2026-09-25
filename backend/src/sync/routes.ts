import { Router } from 'express';
import { authenticate, adminOnly, identity } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { validateBody } from '../validation/request.js';
import { applyOperation, pullChanges } from './service.js';
import { pushSchema, pullSchema } from './validation.js';
export const syncRouter=Router();
syncRouter.use(authenticate);
syncRouter.post('/push',adminOnly,validateBody(pushSchema),async (req,res)=>{
  const ctx=identity(res),input=pushSchema.parse(req.body);
  const results=[];
  for (const op of input.operations) results.push(await applyOperation(ctx,op));
  res.json({results});
});
syncRouter.get('/pull',async (req,res)=>{
  const ctx=identity(res);
  if (ctx.mustChangePassword) throw new HttpError(403,'Password change required');
  const input=pullSchema.parse(req.query);
  res.json(await pullChanges(ctx,input.cursor,input.limit));
});
