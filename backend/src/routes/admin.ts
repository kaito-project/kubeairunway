import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { userRepository, roleRepository, groupMappingRepository } from '../services/database';
import { requireAdmin } from '../middleware/rbac';
import logger from '../lib/logger';

const assignRoleSchema = z.object({
  instanceId: z.string().min(1),
  role: z.enum(['admin', 'deployer', 'viewer']),
  namespaces: z.array(z.string()).min(1),
});

const createGroupMappingSchema = z.object({
  entraGroupId: z.string().min(1),
  entraGroupName: z.string().min(1),
  instanceId: z.string().min(1),
  role: z.enum(['admin', 'deployer', 'viewer']),
  namespaces: z.array(z.string()).min(1),
});

const admin = new Hono()
  .use('/*', requireAdmin())

  .get('/users', async (c) => {
    const users = await userRepository.listAll();
    const usersWithRoles = await Promise.all(
      users.map(async (user) => {
        const roles = await roleRepository.getUserRoles(user.id);
        return { ...user, roles };
      })
    );
    return c.json(usersWithRoles);
  })

  .get('/users/:id', async (c) => {
    const id = c.req.param('id');
    const user = await userRepository.findById(id);
    if (!user) {
      return c.json({ error: { message: 'User not found', statusCode: 404 } }, 404);
    }
    const roles = await roleRepository.getUserRoles(user.id);
    return c.json({ ...user, roles });
  })

  .post('/users/:id/roles', zValidator('json', assignRoleSchema), async (c) => {
    const id = c.req.param('id');
    const { instanceId, role, namespaces } = c.req.valid('json');

    const user = await userRepository.findById(id);
    if (!user) {
      return c.json({ error: { message: 'User not found', statusCode: 404 } }, 404);
    }

    const roleRecord = await roleRepository.findByName(role);
    if (!roleRecord) {
      return c.json({ error: { message: `Role '${role}' not found`, statusCode: 404 } }, 404);
    }

    await roleRepository.assignUserRole(id, instanceId, roleRecord.id, namespaces);
    logger.info({ userId: id, instanceId, role, namespaces }, 'Role assigned to user');

    const roles = await roleRepository.getUserRoles(id);
    return c.json({ ...user, roles }, 201);
  })

  .delete('/users/:id/roles', async (c) => {
    const id = c.req.param('id');
    const instanceId = c.req.query('instance_id');
    const roleName = c.req.query('role');

    if (!instanceId || !roleName) {
      return c.json(
        { error: { message: 'instance_id and role query parameters required', statusCode: 400 } },
        400
      );
    }

    const roleRecord = await roleRepository.findByName(roleName);
    if (!roleRecord) {
      return c.json({ error: { message: `Role '${roleName}' not found`, statusCode: 404 } }, 404);
    }

    await roleRepository.removeUserRole(id, instanceId, roleRecord.id);
    logger.info({ userId: id, instanceId, role: roleName }, 'Role removed from user');

    return c.json({ message: 'Role removed' });
  })

  .get('/group-mappings', async (c) => {
    const mappings = await groupMappingRepository.listAll();
    return c.json(mappings);
  })

  .post('/group-mappings', zValidator('json', createGroupMappingSchema), async (c) => {
    const { entraGroupId, entraGroupName, instanceId, role, namespaces } = c.req.valid('json');

    const roleRecord = await roleRepository.findByName(role);
    if (!roleRecord) {
      return c.json({ error: { message: `Role '${role}' not found`, statusCode: 404 } }, 404);
    }

    const mapping = await groupMappingRepository.create({
      entraGroupId,
      entraGroupName,
      instanceId,
      roleId: roleRecord.id,
      namespaces,
    });
    logger.info({ entraGroupId, instanceId, role }, 'Group mapping created');

    return c.json(mapping, 201);
  })

  .delete('/group-mappings/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = await groupMappingRepository.delete(id);
    if (!deleted) {
      return c.json({ error: { message: 'Group mapping not found', statusCode: 404 } }, 404);
    }
    logger.info({ mappingId: id }, 'Group mapping deleted');
    return c.json({ message: 'Group mapping deleted' });
  });

export default admin;
