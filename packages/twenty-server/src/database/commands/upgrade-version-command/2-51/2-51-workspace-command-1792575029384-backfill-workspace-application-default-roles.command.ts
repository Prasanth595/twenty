import { Command, Option } from 'nest-commander';
import { isDefined } from 'twenty-shared/utils';

import { ProvisionedWorkspaceCommandRunner } from 'src/database/commands/command-runners/provisioned-workspace.command-runner';
import { WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import {
  type RunOnWorkspaceArgs,
  type WorkspaceCommandOptions,
} from 'src/database/commands/command-runners/workspace.command-runner';
import { getAvailableRoleLabel } from 'src/database/commands/upgrade-version-command/2-51/utils/get-available-role-label.util';
import { ApplicationService } from 'src/engine/core-modules/application/application.service';
import { WORKSPACE_CUSTOM_APPLICATION_ROLE_UNIVERSAL_IDENTIFIER } from 'src/engine/core-modules/application/constants/workspace-custom-application-role.constant';
import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import { RegisteredWorkspaceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-workspace-command.decorator';
import { findFlatEntityByUniversalIdentifier } from 'src/engine/metadata-modules/flat-entity/utils/find-flat-entity-by-universal-identifier.util';
import { type FlatRole } from 'src/engine/metadata-modules/flat-role/types/flat-role.type';
import { buildWorkspaceCustomApplicationFlatRole } from 'src/engine/metadata-modules/flat-role/utils/build-workspace-custom-application-flat-role.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';
import { STANDARD_ROLE } from 'src/engine/workspace-manager/twenty-standard-application/constants/standard-role.constant';
import { computeTwentyStandardApplicationAllFlatEntityMaps } from 'src/engine/workspace-manager/twenty-standard-application/utils/twenty-standard-application-all-flat-entity-maps.constant';
import { WorkspaceMigrationBuilderException } from 'src/engine/workspace-manager/workspace-migration/exceptions/workspace-migration-builder-exception';
import { WorkspaceMigrationValidateBuildAndRunService } from 'src/engine/workspace-manager/workspace-migration/services/workspace-migration-validate-build-and-run-service';

type BackfillWorkspaceApplicationDefaultRolesOptions =
  WorkspaceCommandOptions & {
    down?: boolean;
  };

type ApplicationDefaultRoleTarget = {
  flatApplication: FlatApplication;
  roleUniversalIdentifier: string;
  isTwentyStandard: boolean;
};

@RegisteredWorkspaceCommand('2.51.0', 1792575029384)
@Command({
  name: 'upgrade:2-51:backfill-workspace-application-default-roles',
  description:
    'Give the workspace custom and Twenty standard applications their own default role',
})
export class BackfillWorkspaceApplicationDefaultRolesCommand extends ProvisionedWorkspaceCommandRunner<BackfillWorkspaceApplicationDefaultRolesOptions> {
  constructor(
    protected readonly workspaceIteratorService: WorkspaceIteratorService,
    private readonly workspaceCacheService: WorkspaceCacheService,
    private readonly applicationService: ApplicationService,
    private readonly workspaceMigrationValidateBuildAndRunService: WorkspaceMigrationValidateBuildAndRunService,
  ) {
    super(workspaceIteratorService);
  }

  @Option({
    flags: '--down',
    description:
      'Unset both applications default roles and remove the two roles',
    required: false,
  })
  parseDown(): boolean {
    return true;
  }

  override async runOnWorkspace({
    workspaceId,
    options,
  }: RunOnWorkspaceArgs<BackfillWorkspaceApplicationDefaultRolesOptions>): Promise<void> {
    if (options.down) {
      await this.down({ workspaceId, dryRun: options.dryRun ?? false });

      return;
    }

    await this.up({ workspaceId, dryRun: options.dryRun ?? false });
  }

  async up({
    workspaceId,
    dryRun,
  }: {
    workspaceId: string;
    dryRun: boolean;
  }): Promise<void> {
    const targets = await this.getApplicationDefaultRoleTargets(workspaceId);

    for (const target of targets) {
      if (isDefined(target.flatApplication.defaultRoleId)) {
        continue;
      }

      const { flatRoleMaps } = await this.workspaceCacheService.getOrRecompute(
        workspaceId,
        ['flatRoleMaps'],
      );

      const existingFlatRole = findFlatEntityByUniversalIdentifier({
        universalIdentifier: target.roleUniversalIdentifier,
        flatEntityMaps: flatRoleMaps,
      });

      if (dryRun) {
        this.logger.log(
          `[DRY RUN] Workspace ${workspaceId}: would ${isDefined(existingFlatRole) ? 'reuse' : 'create'} the default role of application ${target.flatApplication.id}`,
        );

        continue;
      }

      const flatRole =
        existingFlatRole ??
        (await this.createApplicationRole({
          workspaceId,
          target,
          takenLabels: Object.values(flatRoleMaps.byUniversalIdentifier)
            .filter(isDefined)
            .map(({ label }) => label),
        }));

      await this.applicationService.update(target.flatApplication.id, {
        workspaceId,
        defaultRoleId: flatRole.id,
      });

      this.logger.log(
        `Workspace ${workspaceId}: set role ${flatRole.id} as default role of application ${target.flatApplication.id}`,
      );
    }
  }

  async down({
    workspaceId,
    dryRun,
  }: {
    workspaceId: string;
    dryRun: boolean;
  }): Promise<void> {
    const targets = await this.getApplicationDefaultRoleTargets(workspaceId);

    const { flatRoleMaps } = await this.workspaceCacheService.getOrRecompute(
      workspaceId,
      ['flatRoleMaps'],
    );

    for (const target of targets) {
      const flatRole = findFlatEntityByUniversalIdentifier({
        universalIdentifier: target.roleUniversalIdentifier,
        flatEntityMaps: flatRoleMaps,
      });

      if (!isDefined(flatRole)) {
        continue;
      }

      if (dryRun) {
        this.logger.log(
          `[DRY RUN] Workspace ${workspaceId}: would remove role ${flatRole.id} of application ${target.flatApplication.id}`,
        );

        continue;
      }

      if (target.flatApplication.defaultRoleId === flatRole.id) {
        await this.applicationService.update(target.flatApplication.id, {
          workspaceId,
          defaultRoleId: null,
        });
      }

      await this.runRoleMigrationOrThrow({
        workspaceId,
        target,
        flatRoleToCreate: [],
        flatRoleToDelete: [flatRole],
      });

      this.logger.log(
        `Workspace ${workspaceId}: removed role ${flatRole.id} of application ${target.flatApplication.id}`,
      );
    }
  }

  private async getApplicationDefaultRoleTargets(
    workspaceId: string,
  ): Promise<ApplicationDefaultRoleTarget[]> {
    const { twentyStandardFlatApplication, workspaceCustomFlatApplication } =
      await this.applicationService.findWorkspaceTwentyStandardAndCustomApplicationOrThrow(
        { workspaceId },
      );

    return [
      {
        flatApplication: twentyStandardFlatApplication,
        roleUniversalIdentifier:
          STANDARD_ROLE.standardApplication.universalIdentifier,
        isTwentyStandard: true,
      },
      {
        flatApplication: workspaceCustomFlatApplication,
        roleUniversalIdentifier:
          WORKSPACE_CUSTOM_APPLICATION_ROLE_UNIVERSAL_IDENTIFIER,
        isTwentyStandard: false,
      },
    ];
  }

  private async createApplicationRole({
    workspaceId,
    target,
    takenLabels,
  }: {
    workspaceId: string;
    target: ApplicationDefaultRoleTarget;
    takenLabels: string[];
  }): Promise<FlatRole> {
    const definitionFlatRole = target.isTwentyStandard
      ? this.getStandardApplicationFlatRoleDefinitionOrThrow({
          workspaceId,
          twentyStandardApplicationId: target.flatApplication.id,
        })
      : buildWorkspaceCustomApplicationFlatRole({
          workspaceId,
          workspaceCustomFlatApplication: target.flatApplication,
        });

    const flatRoleToCreate: FlatRole = {
      ...definitionFlatRole,
      label: getAvailableRoleLabel({
        preferredLabel: definitionFlatRole.label,
        takenLabels,
      }),
    };

    await this.runRoleMigrationOrThrow({
      workspaceId,
      target,
      flatRoleToCreate: [flatRoleToCreate],
      flatRoleToDelete: [],
    });

    return flatRoleToCreate;
  }

  private getStandardApplicationFlatRoleDefinitionOrThrow({
    workspaceId,
    twentyStandardApplicationId,
  }: {
    workspaceId: string;
    twentyStandardApplicationId: string;
  }): FlatRole {
    const { allFlatEntityMaps } =
      computeTwentyStandardApplicationAllFlatEntityMaps({
        now: new Date().toISOString(),
        workspaceId,
        twentyStandardApplicationId,
      });

    const standardApplicationFlatRole = findFlatEntityByUniversalIdentifier({
      universalIdentifier: STANDARD_ROLE.standardApplication.universalIdentifier,
      flatEntityMaps: allFlatEntityMaps.flatRoleMaps,
    });

    if (!isDefined(standardApplicationFlatRole)) {
      throw new Error(
        'Standard application role is missing from the Twenty standard definition',
      );
    }

    return standardApplicationFlatRole;
  }

  // Twenty standard metadata is applied literally, never through the side-effect engine
  private async runRoleMigrationOrThrow({
    workspaceId,
    target,
    flatRoleToCreate,
    flatRoleToDelete,
  }: {
    workspaceId: string;
    target: ApplicationDefaultRoleTarget;
    flatRoleToCreate: FlatRole[];
    flatRoleToDelete: FlatRole[];
  }): Promise<void> {
    const args = {
      allFlatEntityOperationByMetadataName: {
        role: {
          flatEntityToCreate: flatRoleToCreate,
          flatEntityToDelete: flatRoleToDelete,
          flatEntityToUpdate: [],
        },
      },
      workspaceId,
      isSystemBuild: true,
      applicationUniversalIdentifier:
        target.flatApplication.universalIdentifier,
    };

    const result = target.isTwentyStandard
      ? await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunLegacyWorkspaceMigration(
          args,
        )
      : await this.workspaceMigrationValidateBuildAndRunService.validateBuildAndRunWorkspaceMigration(
          args,
        );

    if (result.status === 'fail') {
      throw new WorkspaceMigrationBuilderException(
        result,
        `Failed to update the default role of application ${target.flatApplication.id} in workspace ${workspaceId}`,
      );
    }
  }
}
