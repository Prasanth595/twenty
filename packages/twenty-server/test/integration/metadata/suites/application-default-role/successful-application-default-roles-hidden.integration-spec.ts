import gql from 'graphql-tag';
import { executeToolThroughMcp } from 'test/integration/ai/utils/execute-tool-through-mcp.util';
import { findWorkspaceApplicationDefaultRoles } from 'test/integration/metadata/suites/application-default-role/utils/find-workspace-application-default-roles.util';
import { findRoles } from 'test/integration/metadata/suites/role/utils/find-roles.util';
import { makeMetadataApiRequest } from 'test/integration/metadata/suites/utils/make-metadata-api-request.util';
import { jestExpectToBeDefined } from 'test/utils/jest-expect-to-be-defined.util.test';

import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';

describe('The applications default roles are hidden from people', () => {
  let hiddenRoleIds: string[];

  beforeAll(async () => {
    const { standardApplicationRole, customApplicationRole } =
      await findWorkspaceApplicationDefaultRoles(SEED_APPLE_WORKSPACE_ID);

    jestExpectToBeDefined(standardApplicationRole);
    jestExpectToBeDefined(customApplicationRole);
    hiddenRoleIds = [
      standardApplicationRole.roleId,
      customApplicationRole.roleId,
    ];
  });

  it('leaves them out of the roles list the Settings page uses', async () => {
    const { data } = await findRoles({ expectToFail: false });
    const listedRoleIds = data.getRoles.map(({ id }) => id);

    expect(listedRoleIds.length).toBeGreaterThan(0);
    for (const hiddenRoleId of hiddenRoleIds) {
      expect(listedRoleIds).not.toContain(hiddenRoleId);
    }
  });

  it('does not return them by id', async () => {
    for (const hiddenRoleId of hiddenRoleIds) {
      const response = await makeMetadataApiRequest({
        query: gql`
          query GetRole($id: UUID!) {
            getRole(id: $id) {
              id
            }
          }
        `,
        variables: { id: hiddenRoleId },
      });

      expect(response.body.data?.getRole ?? null).toBeNull();
      expect(response.body.errors).toBeDefined();
    }
  });

  it('leaves them out of the list_roles tool', async () => {
    const output = await executeToolThroughMcp<{ roles: { id: string }[] }>({
      toolName: 'list_roles',
      toolArguments: {},
      token: APPLE_JANE_ADMIN_ACCESS_TOKEN,
    });

    expect(output.success).toBe(true);

    const listedRoleIds = (output.result?.roles ?? []).map(({ id }) => id);

    for (const hiddenRoleId of hiddenRoleIds) {
      expect(listedRoleIds).not.toContain(hiddenRoleId);
    }
  });
});
