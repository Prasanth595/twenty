import { Module } from '@nestjs/common';

import { WorkspaceIteratorModule } from 'src/database/commands/command-runners/workspace-iterator.module';
import { MigrateRichTextToTiptapCommand } from 'src/database/commands/upgrade-version-command/2-51/2-51-workspace-command-1792524106000-migrate-rich-text-to-tiptap.command';
import { WorkspaceCacheModule } from 'src/engine/workspace-cache/workspace-cache.module';

@Module({
  imports: [WorkspaceCacheModule, WorkspaceIteratorModule],
  providers: [MigrateRichTextToTiptapCommand],
})
export class V2_51_UpgradeVersionCommandModule {}
