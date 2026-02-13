import { groupMappingRepository, roleRepository } from './database';
import logger from '../lib/logger';

class GroupSyncService {
  /**
   * Sync a user's group memberships with instance access.
   * Called after Entra OAuth login.
   *
   * @param userId - The user's ID in our database
   * @param groupIds - Array of Entra group IDs from the OAuth token
   */
  async syncUserGroups(userId: string, groupIds: string[]): Promise<void> {
    if (!groupIds || groupIds.length === 0) {
      logger.debug({ userId }, 'No groups to sync');
      return;
    }

    let syncedCount = 0;

    for (const groupId of groupIds) {
      const mappings = await groupMappingRepository.findByGroupId(groupId);

      for (const mapping of mappings) {
        const roleId = await this.getRoleId(mapping.role);
        await roleRepository.assignUserRole(
          userId,
          mapping.instanceId,
          roleId,
          mapping.namespaces
        );
        syncedCount++;
      }
    }

    if (syncedCount > 0) {
      logger.info({ userId, syncedCount, groupCount: groupIds.length }, 'Synced user group memberships');
    }
  }

  private async getRoleId(roleName: string): Promise<string> {
    const role = await roleRepository.findByName(roleName);
    if (!role) {
      throw new Error(`Role not found: ${roleName}`);
    }
    return role.id;
  }
}

export const groupSyncService = new GroupSyncService();
