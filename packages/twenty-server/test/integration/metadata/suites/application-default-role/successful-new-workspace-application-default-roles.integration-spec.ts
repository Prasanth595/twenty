import { randomUUID } from 'crypto';

import { findWorkspaceApplicationDefaultRoles } from 'test/integration/metadata/suites/application-default-role/utils/find-workspace-application-default-roles.util';
import { activateWorkspace } from 'test/integration/graphql/utils/activate-workspace.util';
import { getAuthTokensFromLoginToken } from 'test/integration/graphql/utils/get-auth-tokens-from-login-token.util';
import { signUpInNewWorkspace } from 'test/integration/graphql/utils/sign-up-in-new-workspace.util';
import { signUp } from 'test/integration/graphql/utils/sign-up.util';
import { getAppProviderByClassName } from 'test/integration/utils/get-app-provider-by-class-name.util';
import { isDefined } from 'twenty-shared/utils';

import { type WorkspaceService } from 'src/engine/core-modules/workspace/services/workspace.service';

const ADMIN_EQUIVALENT_LOCKED_HIDDEN_ROLE = {
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
};

describe('A new workspace gives its applications their own default role', () => {
  let workspaceId: string | undefined;

  beforeAll(async () => {
    jest.useRealTimers();

    const email = `test-${randomUUID()}@example.com`;
    const { data: signUpData } = await signUp({
      input: { email, password: 'Test123!@#' },
      expectToFail: false,
    });

    await globalThis.testDataSource.query(
      'UPDATE core."user" SET "isEmailVerified" = true WHERE email = $1',
      [email],
    );

    const {
      data: { signUpInNewWorkspace: newWorkspaceData },
    } = await signUpInNewWorkspace({
      accessToken:
        signUpData.signUp.tokens.accessOrWorkspaceAgnosticToken.token,
      expectToFail: false,
    });

    workspaceId = newWorkspaceData.workspace.id;

    const {
      data: { getAuthTokensFromLoginToken: authTokensData },
    } = await getAuthTokensFromLoginToken({
      origin: newWorkspaceData.workspace.workspaceUrls.subdomainUrl,
      loginToken: newWorkspaceData.loginToken.token,
      expectToFail: false,
    });

    await activateWorkspace({
      accessToken: authTokensData.tokens.accessOrWorkspaceAgnosticToken.token,
      expectToFail: false,
    });
  });

  afterAll(async () => {
    if (isDefined(workspaceId)) {
      await getAppProviderByClassName<WorkspaceService>(
        'WorkspaceService',
      ).deleteWorkspace(workspaceId);
    }
  });

  it('gives the standard application a locked, hidden, Admin-equivalent role it owns', async () => {
    const { standardApplicationRole } =
      await findWorkspaceApplicationDefaultRoles(workspaceId as string);

    expect(standardApplicationRole).toMatchObject({
      ...ADMIN_EQUIVALENT_LOCKED_HIDDEN_ROLE,
      roleId: expect.any(String),
      roleApplicationId: standardApplicationRole?.applicationId,
    });
  });

  it('gives the custom application a locked, hidden, Admin-equivalent role it owns', async () => {
    const { customApplicationRole } =
      await findWorkspaceApplicationDefaultRoles(workspaceId as string);

    expect(customApplicationRole).toMatchObject({
      ...ADMIN_EQUIVALENT_LOCKED_HIDDEN_ROLE,
      roleId: expect.any(String),
      roleApplicationId: customApplicationRole?.applicationId,
    });
  });
});
