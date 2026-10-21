import { findFlatEntityByUniversalIdentifier } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier.util';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';
import { TWENTY_STANDARD_APPLICATION } from 'src/engine/workspace-manager/twenty-standard-application/constants/twenty-standard-applications';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';

const TWENTY_STANDARD_APPLICATION_ID = '20202020-0000-4000-8000-000000000001';

const ADMIN_EQUIVALENT_PERMISSIONS = [
  'canUpdateAllSettings',
  'canAccessAllTools',
  'canReadAllObjectRecords',
  'canUpdateAllObjectRecords',
  'canSoftDeleteAllObjectRecords',
  'canDestroyAllObjectRecords',
] as const;

describe('standard roles', () => {
  const { allFlatEntityMaps } =
    computeTwentyStandardApplicationAllFlatEntityMaps({
      now: '2026-01-01T00:00:00.000Z',
      workspaceId: '20202020-0000-4000-8000-000000000000',
      twentyStandardApplicationId: TWENTY_STANDARD_APPLICATION_ID,
    });

  const findStandardRole = (universalIdentifier: string) =>
    findFlatEntityByUniversalIdentifier({
      universalIdentifier,
      flatEntityMaps: allFlatEntityMaps.flatRoleMaps,
    });

  const adminRole = findStandardRole(STANDARD_ROLE.admin.universalIdentifier);
  const standardApplicationRole = findStandardRole(
    STANDARD_ROLE.standardApplication.universalIdentifier,
  );

  it('defines the standard application role next to Admin, owned by the standard application', () => {
    expect(adminRole).toBeDefined();
    expect(standardApplicationRole).toMatchObject({
      applicationId: TWENTY_STANDARD_APPLICATION_ID,
      applicationUniversalIdentifier:
        TWENTY_STANDARD_APPLICATION.universalIdentifier,
    });
    expect(standardApplicationRole?.label).not.toBe(adminRole?.label);
  });

  it.each(ADMIN_EQUIVALENT_PERMISSIONS)(
    'grants the standard application role the same %s as Admin',
    (permission) => {
      expect(adminRole?.[permission]).toBe(true);
      expect(standardApplicationRole?.[permission]).toBe(
        adminRole?.[permission],
      );
    },
  );

  it('locks and hides the standard application role', () => {
    expect(standardApplicationRole).toMatchObject({
      isEditable: false,
      isSystem: true,
      canBeAssignedToUsers: false,
      canBeAssignedToAgents: false,
      canBeAssignedToApiKeys: false,
    });
  });

  it('keeps Admin listed', () => {
    expect(adminRole?.isSystem).toBe(false);
  });
});
