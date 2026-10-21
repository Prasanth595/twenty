import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { BackfillWorkspaceApplicationDefaultRolesCommand } from 'src/database/commands/upgrade-version-command/2-51/2-51-workspace-command-1792575029384-backfill-workspace-application-default-roles.command';
import { type ApplicationService } from 'src/engine/core-modules/application/application.service';
import {
  WORKSPACE_CUSTOM_APPLICATION_ROLE_LABEL,
  WORKSPACE_CUSTOM_APPLICATION_ROLE_UNIVERSAL_IDENTIFIER,
} from 'src/engine/core-modules/application/constants/workspace-custom-application-role.constant';
import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { STANDARD_APPLICATION_ROLE_LABEL } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-application-role-label.constant';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';
import { TWENTY_STANDARD_APPLICATION } from 'src/engine/workspace-manager/twenty-standard-application/constants/twenty-standard-applications';
import { type WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

const WORKSPACE_ID = '20202020-0000-4000-8000-000000000001';
const STANDARD_APPLICATION_ID = '20202020-0000-4000-8000-0000000000a1';
const CUSTOM_APPLICATION_ID = '20202020-0000-4000-8000-0000000000a2';

type FakeApplication = {
  id: string;
  universalIdentifier: string;
  defaultRoleId: string | null;
};

type RoleMigrationArgs = {
  allFlatEntityOperationByMetadataName: {
    role: { flatEntityToCreate: FlatRole[]; flatEntityToDelete: FlatRole[] };
  };
  isSystemBuild: boolean;
  applicationUniversalIdentifier: string;
};

const buildExistingRole = (label: string): FlatRole =>
  ({
    id: `role-${label}`,
    universalIdentifier: `universal-${label}`,
    label,
  }) as FlatRole;

describe('BackfillWorkspaceApplicationDefaultRolesCommand', () => {
  let applications: Record<string, FakeApplication>;
  let roles: FlatRole[];
  let migrationCalls: RoleMigrationArgs[];
  let command: BackfillWorkspaceApplicationDefaultRolesCommand;

  const applyRoleMigration = async (args: RoleMigrationArgs) => {
    migrationCalls.push(args);

    const { flatEntityToCreate, flatEntityToDelete } =
      args.allFlatEntityOperationByMetadataName.role;

    roles = [
      ...roles.filter(
        (role) =>
          !flatEntityToDelete.some(
            (roleToDelete) => roleToDelete.id === role.id,
          ),
      ),
      ...flatEntityToCreate,
    ];

    return { status: 'success' };
  };

  const getRoleOwnedBy = (applicationId: string) =>
    roles.find((role) => role.applicationId === applicationId);

  beforeEach(() => {
    applications = {
      [STANDARD_APPLICATION_ID]: {
        id: STANDARD_APPLICATION_ID,
        universalIdentifier: TWENTY_STANDARD_APPLICATION.universalIdentifier,
        defaultRoleId: null,
      },
      [CUSTOM_APPLICATION_ID]: {
        id: CUSTOM_APPLICATION_ID,
        universalIdentifier: CUSTOM_APPLICATION_ID,
        defaultRoleId: null,
      },
    };
    roles = [buildExistingRole('Admin'), buildExistingRole('Member')];
    migrationCalls = [];

    const workspaceCacheService = {
      getOrRecompute: jest.fn(async () => ({
        flatRoleMaps: {
          byUniversalIdentifier: Object.fromEntries(
            roles.map((role) => [role.universalIdentifier, role]),
          ),
        },
      })),
    } as unknown as WorkspaceCacheService;

    const applicationService = {
      findWorkspaceTwentyStandardAndCustomApplicationOrThrow: jest.fn(
        async () => ({
          twentyStandardFlatApplication: {
            ...applications[STANDARD_APPLICATION_ID],
          },
          workspaceCustomFlatApplication: {
            ...applications[CUSTOM_APPLICATION_ID],
          },
        }),
      ),
      update: jest.fn(
        async (
          id: string,
          { defaultRoleId }: { defaultRoleId: string | null },
        ) => {
          applications[id] = { ...applications[id], defaultRoleId };
        },
      ),
    } as unknown as ApplicationService;

    const workspaceMigrationValidateBuildAndRunService = {
      validateBuildAndRunLegacyWorkspaceMigration: jest.fn(applyRoleMigration),
      validateBuildAndRunWorkspaceMigration: jest.fn(applyRoleMigration),
    } as unknown as WorkspaceMigrationValidateBuildAndRunService;

    command = new BackfillWorkspaceApplicationDefaultRolesCommand(
      {} as WorkspaceIteratorService,
      workspaceCacheService,
      applicationService,
      workspaceMigrationValidateBuildAndRunService,
    );

    jest.spyOn(command['logger'], 'log').mockImplementation();
  });

  const run = (options: { dryRun?: boolean; down?: boolean } = {}) =>
    command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      options,
      index: 0,
      total: 1,
    });

  it('creates a locked, hidden, Admin-equivalent role for each application and sets it as its default role', async () => {
    await run();

    const standardApplicationRole = getRoleOwnedBy(STANDARD_APPLICATION_ID);
    const customApplicationRole = getRoleOwnedBy(CUSTOM_APPLICATION_ID);

    expect(standardApplicationRole).toMatchObject({
      universalIdentifier: STANDARD_ROLE.standardApplication.universalIdentifier,
      label: STANDARD_APPLICATION_ROLE_LABEL,
    });
    expect(customApplicationRole).toMatchObject({
      universalIdentifier: WORKSPACE_CUSTOM_APPLICATION_ROLE_UNIVERSAL_IDENTIFIER,
      label: WORKSPACE_CUSTOM_APPLICATION_ROLE_LABEL,
    });

    for (const role of [standardApplicationRole, customApplicationRole]) {
      expect(role).toMatchObject({
        isEditable: false,
        isSystem: true,
        canUpdateAllSettings: true,
        canAccessAllTools: true,
        canReadAllObjectRecords: true,
        canUpdateAllObjectRecords: true,
        canSoftDeleteAllObjectRecords: true,
        canDestroyAllObjectRecords: true,
        canBeAssignedToUsers: false,
        canBeAssignedToAgents: false,
        canBeAssignedToApiKeys: false,
      });
    }

    expect(applications[STANDARD_APPLICATION_ID].defaultRoleId).toBe(
      standardApplicationRole?.id,
    );
    expect(applications[CUSTOM_APPLICATION_ID].defaultRoleId).toBe(
      customApplicationRole?.id,
    );
  });

  it('writes each role as a system build owned by its application', async () => {
    await run();

    expect(
      migrationCalls.map(({ isSystemBuild, applicationUniversalIdentifier }) => ({
        isSystemBuild,
        applicationUniversalIdentifier,
      })),
    ).toEqual([
      {
        isSystemBuild: true,
        applicationUniversalIdentifier:
          TWENTY_STANDARD_APPLICATION.universalIdentifier,
      },
      {
        isSystemBuild: true,
        applicationUniversalIdentifier: CUSTOM_APPLICATION_ID,
      },
    ]);
  });

  it('changes nothing on a second run', async () => {
    await run();

    const rolesAfterFirstRun = [...roles];
    const applicationsAfterFirstRun = structuredClone(applications);

    migrationCalls = [];

    await run();

    expect(migrationCalls).toEqual([]);
    expect(roles).toEqual(rolesAfterFirstRun);
    expect(applications).toEqual(applicationsAfterFirstRun);
  });

  it('leaves an application that already has a default role alone', async () => {
    applications[CUSTOM_APPLICATION_ID].defaultRoleId = 'role-Admin';

    await run();

    expect(applications[CUSTOM_APPLICATION_ID].defaultRoleId).toBe(
      'role-Admin',
    );
    expect(getRoleOwnedBy(CUSTOM_APPLICATION_ID)).toBeUndefined();
    expect(getRoleOwnedBy(STANDARD_APPLICATION_ID)).toBeDefined();
  });

  it('picks a free label when a role already uses the default one', async () => {
    roles.push(
      buildExistingRole(STANDARD_APPLICATION_ROLE_LABEL),
      buildExistingRole(WORKSPACE_CUSTOM_APPLICATION_ROLE_LABEL),
      buildExistingRole(`${WORKSPACE_CUSTOM_APPLICATION_ROLE_LABEL} 2`),
    );

    await run();

    expect(getRoleOwnedBy(STANDARD_APPLICATION_ID)?.label).toBe(
      `${STANDARD_APPLICATION_ROLE_LABEL} 2`,
    );
    expect(getRoleOwnedBy(CUSTOM_APPLICATION_ID)?.label).toBe(
      `${WORKSPACE_CUSTOM_APPLICATION_ROLE_LABEL} 3`,
    );
  });

  it('writes nothing in dry-run mode', async () => {
    await run({ dryRun: true });

    expect(migrationCalls).toEqual([]);
    expect(applications[STANDARD_APPLICATION_ID].defaultRoleId).toBeNull();
    expect(applications[CUSTOM_APPLICATION_ID].defaultRoleId).toBeNull();
  });

  it('down unsets both default roles and removes the two roles', async () => {
    const rolesBeforeUp = [...roles];

    await run();
    await run({ down: true });

    expect(applications[STANDARD_APPLICATION_ID].defaultRoleId).toBeNull();
    expect(applications[CUSTOM_APPLICATION_ID].defaultRoleId).toBeNull();
    expect(roles).toEqual(rolesBeforeUp);
  });
});
