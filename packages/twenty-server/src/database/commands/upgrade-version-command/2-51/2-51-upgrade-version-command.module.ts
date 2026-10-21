import { Module } from '@nestjs/common';

import { WorkspaceIteratorModule } from 'src/database/commands/command-runners/workspace-iterator.module';
import { BackfillWorkspaceApplicationDefaultRolesCommand } from 'src/database/commands/upgrade-version-command/2-51/2-51-workspace-command-1792575029384-backfill-workspace-application-default-roles.command';
import { ApplicationModule } from 'src/engine/core-modules/application/application.module';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';
import { WorkspaceMigrationModule } from 'src/engine/workspace-manager/workspace-migration/workspace-migration.module';

@Module({
  imports: [
    ApplicationModule,
    WorkspaceCacheModule,
    WorkspaceIteratorModule,
    WorkspaceMigrationModule,
  ],
  providers: [BackfillWorkspaceApplicationDefaultRolesCommand],
})
export class V2_51_UpgradeVersionCommandModule {}
