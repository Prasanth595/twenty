import gql from 'graphql-tag';
import { executeToolThroughMcp } from 'test/integration/ai/utils/execute-tool-through-mcp.util';
import { TEST_AI_MODEL_ID } from 'test/integration/constants/test-ai-model-ids.constants';
import { createOneAgent } from 'test/integration/metadata/suites/agent/utils/create-one-agent.util';
import { deleteOneAgent } from 'test/integration/metadata/suites/agent/utils/delete-one-agent.util';
import {
  type ApplicationDefaultRole,
  findWorkspaceApplicationDefaultRoles,
} from 'test/integration/metadata/suites/application-default-role/utils/find-workspace-application-default-roles.util';
import { upsertFieldPermissions } from 'test/integration/metadata/suites/field-permission/utils/upsert-field-permissions.util';
import { findManyObjectMetadata } from 'test/integration/metadata/suites/object-metadata/utils/find-many-object-metadata.util';
import { upsertObjectPermissions } from 'test/integration/metadata/suites/object-permission/utils/upsert-object-permissions.util';
import { upsertPermissionFlags } from 'test/integration/metadata/suites/role-permission-flag/utils/upsert-permission-flags.util';
import { deleteOneRole } from 'test/integration/metadata/suites/role/utils/delete-one-role.util';
import { updateOneRole } from 'test/integration/metadata/suites/role/utils/update-one-role.util';
import { updateWorkspaceMemberRole } from 'test/integration/metadata/suites/role/utils/update-workspace-member-role.util';
import { upsertRowLevelPermissionPredicates } from 'test/integration/metadata/suites/row-level-permission-predicate/utils/upsert-row-level-permission-predicates.util';
import { makeMetadataApiRequest } from 'test/integration/metadata/suites/utils/make-metadata-api-request.util';
import { jestExpectToBeDefined } from 'test/utils/jest-expect-to-be-defined.util.test';
import { PermissionFlagType } from 'twenty-shared/constants';
import { RowLevelPermissionPredicateOperand } from 'twenty-shared/types';

import { API_KEY_DATA_SEED_IDS } from 'src/engine/workspace-manager/dev-seeder/data/constants/api-key-data-seeds.constant';
import { SEED_APPLE_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { WORKSPACE_MEMBER_DATA_SEED_IDS } from 'src/engine/workspace-manager/dev-seeder/data/constants/workspace-member-data-seeds.constant';

type RoleName = 'standardApplicationRole' | 'customApplicationRole';

const ROLE_NAMES: RoleName[] = [
  'standardApplicationRole',
  'customApplicationRole',
];

const readRoleState = async (roleId: string) => {
  const [role] = await globalThis.testDataSource.query(
    `SELECT * FROM core.role WHERE id = $1`,
    [roleId],
  );
  const dependents = await Promise.all(
    [
      'roleTarget',
      'objectPermission',
      'fieldPermission',
      'rolePermissionFlag',
      'rowLevelPermissionPredicate',
      'rowLevelPermissionPredicateGroup',
    ].map(async (table) => {
      const [{ count }] = await globalThis.testDataSource.query(
        `SELECT count(*)::int AS count FROM core."${table}" WHERE "roleId" = $1`,
        [roleId],
      );

      return [table, count];
    }),
  );

  return { role, dependents: Object.fromEntries(dependents) };
};

describe('A workspace Admin member cannot change the applications default roles', () => {
  const roles = {} as Record<RoleName, ApplicationDefaultRole>;
  let companyObjectMetadataId: string;
  let companyNameFieldMetadataId: string;
  let agentId: string;

  beforeAll(async () => {
    const { standardApplicationRole, customApplicationRole } =
      await findWorkspaceApplicationDefaultRoles(SEED_APPLE_WORKSPACE_ID);

    jestExpectToBeDefined(standardApplicationRole);
    jestExpectToBeDefined(customApplicationRole);
    roles.standardApplicationRole = standardApplicationRole;
    roles.customApplicationRole = customApplicationRole;

    const { objects } = await findManyObjectMetadata({
      expectToFail: false,
      input: { filter: {}, paging: { first: 1000 } },
      gqlFields: `
        id
        nameSingular
        fieldsList {
          id
          name
        }
      `,
    });
    const companyObjectMetadata = objects.find(
      (object: { nameSingular: string }) => object.nameSingular === 'company',
    );

    jestExpectToBeDefined(companyObjectMetadata);
    companyObjectMetadataId = companyObjectMetadata.id;
    const companyNameFieldMetadata = companyObjectMetadata.fieldsList?.find(
      (field: { name: string }) => field.name === 'name',
    );

    jestExpectToBeDefined(companyNameFieldMetadata);
    companyNameFieldMetadataId = companyNameFieldMetadata.id;

    const { data } = await createOneAgent({
      expectToFail: false,
      input: {
        label: 'Application default role assignment probe',
        prompt: 'Answer what you are asked',
        modelId: TEST_AI_MODEL_ID,
      },
    });

    agentId = data.createOneAgent.id;
  });

  afterAll(async () => {
    await deleteOneAgent({ expectToFail: false, input: { id: agentId } });
  });

  describe.each(ROLE_NAMES)('%s', (roleName) => {
    let roleStateBefore: Awaited<ReturnType<typeof readRoleState>>;
    const roleId = () => roles[roleName].roleId;

    beforeAll(async () => {
      roleStateBefore = await readRoleState(roleId());
    });

    afterAll(async () => {
      expect(await readRoleState(roleId())).toEqual(roleStateBefore);
    });

    it('refuses updateOneRole', async () => {
      const { errors } = await updateOneRole({
        expectToFail: true,
        input: {
          idToUpdate: roleId(),
          updatePayload: { canReadAllObjectRecords: false },
        },
      });

      expect(errors).toBeDefined();
    });

    it('refuses deleteOneRole', async () => {
      const { errors } = await deleteOneRole({
        expectToFail: true,
        input: { idToDelete: roleId() },
      });

      expect(errors).toBeDefined();
    });

    it('refuses object permissions', async () => {
      const { errors } = await upsertObjectPermissions({
        expectToFail: true,
        input: {
          roleId: roleId(),
          objectPermissions: [
            {
              objectMetadataId: companyObjectMetadataId,
              canReadObjectRecords: false,
            },
          ],
        },
      });

      expect(errors).toBeDefined();
    });

    it('refuses field permissions', async () => {
      const { errors } = await upsertFieldPermissions({
        expectToFail: true,
        input: {
          roleId: roleId(),
          fieldPermissions: [
            {
              objectMetadataId: companyObjectMetadataId,
              fieldMetadataId: companyNameFieldMetadataId,
              canReadFieldValue: false,
              canUpdateFieldValue: false,
            },
          ],
        },
      });

      expect(errors).toBeDefined();
    });

    it('refuses permission flags', async () => {
      const { errors } = await upsertPermissionFlags({
        expectToFail: true,
        input: {
          roleId: roleId(),
          permissionFlagKeys: [PermissionFlagType.WORKFLOWS],
        },
      });

      expect(errors).toBeDefined();
    });

    it('refuses row-level permission predicates', async () => {
      const { errors } = await upsertRowLevelPermissionPredicates({
        expectToFail: true,
        input: {
          roleId: roleId(),
          objectMetadataId: companyObjectMetadataId,
          predicates: [
            {
              fieldMetadataId: companyNameFieldMetadataId,
              operand: RowLevelPermissionPredicateOperand.CONTAINS,
              value: 'Apple',
            },
          ],
          predicateGroups: [],
        },
      });

      expect(errors).toBeDefined();
    });

    it('refuses assigning it to a member', async () => {
      const { errors } = await updateWorkspaceMemberRole({
        expectToFail: true,
        input: {
          workspaceMemberId: WORKSPACE_MEMBER_DATA_SEED_IDS.JONY,
          roleId: roleId(),
        },
      });

      expect(errors).toBeDefined();
    });

    it('refuses assigning it to an API key', async () => {
      const response = await makeMetadataApiRequest({
        query: gql`
          mutation AssignRoleToApiKey($apiKeyId: UUID!, $roleId: UUID!) {
            assignRoleToApiKey(apiKeyId: $apiKeyId, roleId: $roleId)
          }
        `,
        variables: { apiKeyId: API_KEY_DATA_SEED_IDS.ID_1, roleId: roleId() },
      });

      expect(response.body.errors).toBeDefined();
    });

    it('refuses assigning it to an agent', async () => {
      const response = await makeMetadataApiRequest({
        query: gql`
          mutation AssignRoleToAgent($agentId: UUID!, $roleId: UUID!) {
            assignRoleToAgent(agentId: $agentId, roleId: $roleId)
          }
        `,
        variables: { agentId, roleId: roleId() },
      });

      expect(response.body.errors).toBeDefined();
    });

    it.each([
      {
        toolName: 'update_role',
        toolArguments: () => ({
          roleId: roleId(),
          update: { canReadAllObjectRecords: false },
        }),
      },
      {
        toolName: 'delete_role',
        toolArguments: () => ({ roleId: roleId() }),
      },
      {
        toolName: 'upsert_object_permissions',
        toolArguments: () => ({
          roleId: roleId(),
          objectPermissions: [
            {
              objectMetadataId: companyObjectMetadataId,
              canReadObjectRecords: false,
            },
          ],
        }),
      },
      {
        toolName: 'upsert_row_level_permission_rules',
        toolArguments: () => ({
          roleId: roleId(),
          objectMetadataId: companyObjectMetadataId,
          predicates: [
            {
              fieldMetadataId: companyNameFieldMetadataId,
              operand: RowLevelPermissionPredicateOperand.CONTAINS,
              value: 'Apple',
            },
          ],
          predicateGroups: [],
        }),
      },
      {
        toolName: 'assign_role_to_workspace_member',
        toolArguments: () => ({
          workspaceMemberId: WORKSPACE_MEMBER_DATA_SEED_IDS.JONY,
          roleId: roleId(),
        }),
      },
    ])(
      'refuses the $toolName role tool',
      async ({ toolName, toolArguments }) => {
        const output = await executeToolThroughMcp({
          toolName,
          toolArguments: toolArguments(),
          token: APPLE_JANE_ADMIN_ACCESS_TOKEN,
        });

        expect(output.success).toBe(false);
      },
    );
  });
});
