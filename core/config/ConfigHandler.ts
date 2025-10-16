import { ConfigResult } from "@continuedev/config-yaml";

import { ControlPlaneClient } from "../control-plane/client.js";
import {
  BrowserSerializedContinueConfig,
  ContinueConfig,
  IContextProvider,
  IDE,
  IdeSettings,
  ILLMLogger,
} from "../index.js";
import { GlobalContext } from "../util/GlobalContext.js";

import {
  AuthType,
  ControlPlaneSessionInfo,
} from "../control-plane/AuthTypes.js";
import { getControlPlaneEnv } from "../control-plane/env.js";
import { logger } from "../util/logger.js";
import {
  ASSISTANTS,
  getAllDotContinueDefinitionFiles,
  LoadAssistantFilesOptions,
} from "./loadLocalAssistants.js";
import LocalProfileLoader from "./profile/LocalProfileLoader.js";
import PlatformProfileLoader from "./profile/PlatformProfileLoader.js";
import {
  OrganizationDescription,
  OrgWithProfiles,
  ProfileDescription,
  ProfileLifecycleManager,
  SerializedOrgWithProfiles,
} from "./ProfileLifecycleManager.js";

export type { ProfileDescription };

type ConfigUpdateFunction = (payload: ConfigResult<ContinueConfig>) => void;

export class ConfigHandler {
  controlPlaneClient: ControlPlaneClient;
  private readonly globalContext = new GlobalContext();
  private globalLocalProfileManager: ProfileLifecycleManager;

  private organizations: OrgWithProfiles[] = [];
  currentProfile: ProfileLifecycleManager | null;
  currentOrg: OrgWithProfiles;

  constructor(
    private readonly ide: IDE,
    private ideSettingsPromise: Promise<IdeSettings>,
    private llmLogger: ILLMLogger,
    sessionInfoPromise: Promise<ControlPlaneSessionInfo | undefined>,
  ) {
    this.ide = ide;
    this.ideSettingsPromise = ideSettingsPromise;
    this.controlPlaneClient = new ControlPlaneClient(
      sessionInfoPromise,
      ideSettingsPromise,
    );

    // This profile manager will always be available
    this.globalLocalProfileManager = new ProfileLifecycleManager(
      new LocalProfileLoader(
        ide,
        ideSettingsPromise,
        this.controlPlaneClient,
        this.llmLogger,
      ),
      this.ide,
    );

    // Just to be safe, always force a default personal org with local profile manager
    this.currentProfile = this.globalLocalProfileManager;
    const personalOrg: OrgWithProfiles = {
      currentProfile: this.globalLocalProfileManager,
      profiles: [this.globalLocalProfileManager],
      ...this.PERSONAL_ORG_DESC,
    };

    this.currentOrg = personalOrg;
    this.organizations = [personalOrg];

    void this.cascadeInit();
  }

  private workspaceDirs: string[] | null = null;
  async getWorkspaceId() {
    if (!this.workspaceDirs) {
      this.workspaceDirs = await this.ide.getWorkspaceDirs();
    }
    return this.workspaceDirs.join("&");
  }

  async getProfileKey(orgId: string) {
    const workspaceId = await this.getWorkspaceId();
    return `${workspaceId}:::${orgId}`;
  }

  private async cascadeInit() {
    this.workspaceDirs = null; // forces workspace dirs reload

    const orgs = await this.getOrgs();

    // Figure out selected org
    const workspaceId = await this.getWorkspaceId();
    const selectedOrgs =
      this.globalContext.get("lastSelectedOrgIdForWorkspace") ?? {};
    const currentSelection = selectedOrgs[workspaceId];

    const firstNonPersonal = orgs.find(
      (org) => org.id !== this.PERSONAL_ORG_DESC.id,
    );
    const fallback = firstNonPersonal ?? orgs[0];
    // note, ignoring case of zero orgs since should never happen

    let selectedOrg: OrgWithProfiles;
    if (!currentSelection) {
      selectedOrg = fallback;
    } else {
      const match = orgs.find((org) => org.id === currentSelection);
      if (match) {
        selectedOrg = match;
      } else {
        selectedOrg = fallback;
      }
    }

    this.globalContext.update("lastSelectedOrgIdForWorkspace", {
      ...selectedOrgs,
      [workspaceId]: selectedOrg.id,
    });

    this.organizations = orgs;
    this.currentOrg = selectedOrg;
    this.currentProfile = selectedOrg.currentProfile;
    await this.reloadConfig();
  }

  private async loadProfiles(org: any) {
    const response = await fetch(
      // "http://192.168.20.195:8081/lowcodeback/ai/continue/ide/list-assistants?organizationId=" +
      "http://121.43.97.233:7080/lowcodeback-test/ai/continue/ide/list-assistants?organizationId=" +
        // "https://lc.yinhaiyun.com/lowcodeback-test/ai/continue/ide/list-assistants?organizationId=" +
        org.id,
      {
        method: "POST",
        headers: await this.controlPlaneClient.setAuthHeader({}),
      },
    );
    if (!response.ok) {
      return org;
    }

    let profiles;
    try {
      profiles = await response.json();
    } catch (e) {
      return org;
    }

    if (!Array.isArray(profiles)) {
      return org;
    }

    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      const loader = await PlatformProfileLoader.create({
        configResult: profile.configResult,
        ownerSlug: profile.ownerSlug,
        packageSlug: profile.packageSlug,
        iconUrl: profile.iconUrl,
        versionSlug: profile.configResult?.config?.version ?? "latest",
        controlPlaneClient: this.controlPlaneClient,
        ide: this.ide,
        ideSettingsPromise: this.ideSettingsPromise,
        llmLogger: this.llmLogger,
        rawYaml: profile.rawYaml,
        orgScopeId: null,
      });
      profiles[i] = new ProfileLifecycleManager(loader, this.ide);
    }

    org = await this.rectifyProfilesForOrg(org, profiles);
    return org;
  }

  private async loadOrgs() {
    const response = await fetch(
      // "http://192.168.20.195:8081/lowcodeback/ai/continue/ide/list-organizations",
      "http://121.43.97.233:7080/lowcodeback-test/ai/continue/ide/list-organizations",
      // "https://lc.yinhaiyun.com/lowcodeback-test/ai/continue/ide/list-organizations",
      {
        method: "POST",
        headers: await this.controlPlaneClient.setAuthHeader({}),
      },
    );
    if (!response.ok) {
      return null;
    }

    let orgs;
    try {
      orgs = await response.json();
    } catch (e) {
      return null;
    }

    orgs = orgs.organizations ?? [];
    for (let j = 0; j < orgs.length; j++) {
      orgs[j] = await this.loadProfiles(orgs[j]);
    }

    return orgs;
  }

  private async getOrgs(): Promise<OrgWithProfiles[]> {
    let orgs = await this.loadOrgs();
    orgs ??= [];
    if (orgs.length <= 0) {
      orgs.push(await this.getLocalOrg());
    }

    return orgs;
  }

  getSerializedOrgs(): SerializedOrgWithProfiles[] {
    return this.organizations.map((org) => ({
      iconUrl: org.iconUrl,
      id: org.id,
      name: org.name,
      slug: org.slug,
      profiles: org.profiles.map((profile) => profile.profileDescription),
      selectedProfileId: org.currentProfile?.profileDescription.id || null,
    }));
  }

  private async getHubProfiles(orgScopeId: string | null) {
    const assistants = await this.controlPlaneClient.listAssistants(orgScopeId);

    return await Promise.all(
      assistants.map(async (assistant) => {
        const profileLoader = await PlatformProfileLoader.create({
          configResult: {
            ...assistant.configResult,
            config: assistant.configResult.config,
          },
          ownerSlug: assistant.ownerSlug,
          packageSlug: assistant.packageSlug,
          iconUrl: assistant.iconUrl,
          versionSlug: assistant.configResult.config?.version ?? "latest",
          controlPlaneClient: this.controlPlaneClient,
          ide: this.ide,
          ideSettingsPromise: this.ideSettingsPromise,
          llmLogger: this.llmLogger,
          rawYaml: assistant.rawYaml,
          orgScopeId: orgScopeId,
        });

        return new ProfileLifecycleManager(profileLoader, this.ide);
      }),
    );
  }

  private async getNonPersonalHubOrg(
    org: OrganizationDescription,
  ): Promise<OrgWithProfiles> {
    const localProfiles = await this.getLocalProfiles({
      includeGlobal: false,
      includeWorkspace: true,
    });
    const profiles = [...(await this.getHubProfiles(org.id)), ...localProfiles];
    return this.rectifyProfilesForOrg(org, profiles);
  }

  private PERSONAL_ORG_DESC: OrganizationDescription = {
    iconUrl: "",
    id: "personal",
    name: "Personal",
    slug: undefined,
  };
  private async getPersonalHubOrg() {
    const localProfiles = await this.getLocalProfiles({
      includeGlobal: true,
      includeWorkspace: true,
    });
    const hubProfiles = await this.getHubProfiles(null);
    const profiles = [...hubProfiles, ...localProfiles];
    return this.rectifyProfilesForOrg(this.PERSONAL_ORG_DESC, profiles);
  }

  private async getLocalOrg() {
    const localProfiles = await this.getLocalProfiles({
      includeGlobal: true,
      includeWorkspace: true,
    });
    return this.rectifyProfilesForOrg(this.PERSONAL_ORG_DESC, localProfiles);
  }

  private async rectifyProfilesForOrg(
    org: OrganizationDescription,
    profiles: ProfileLifecycleManager[],
  ): Promise<OrgWithProfiles> {
    const profileKey = await this.getProfileKey(org.id);
    const selectedProfiles =
      this.globalContext.get("lastSelectedProfileForWorkspace") ?? {};

    const currentSelection = selectedProfiles[profileKey];

    const firstNonLocal = profiles.find(
      (profile) => profile.profileDescription.profileType !== "local",
    );
    const fallback =
      firstNonLocal ?? (profiles.length > 0 ? profiles[0] : null);

    let currentProfile: ProfileLifecycleManager | null;
    if (!currentSelection) {
      currentProfile = fallback;
    } else {
      const match = profiles.find(
        (profile) => profile.profileDescription.id === currentSelection,
      );
      if (match) {
        currentProfile = match;
      } else {
        currentProfile = fallback;
      }
    }

    if (currentProfile) {
      this.globalContext.update("lastSelectedProfileForWorkspace", {
        ...selectedProfiles,
        [profileKey]: currentProfile.profileDescription.id,
      });
    }

    return {
      ...org,
      profiles,
      currentProfile,
    };
  }

  async getLocalProfiles(options: LoadAssistantFilesOptions) {
    /**
     * Users can define as many local assistants as they want in a `.continue/assistants` folder
     */

    // Local customization disabled for on-premise deployments
    const env = await getControlPlaneEnv(this.ide.getIdeSettings());
    if (env.AUTH_TYPE === AuthType.OnPrem) {
      return [];
    }

    const localProfiles: ProfileLifecycleManager[] = [];

    if (options.includeGlobal) {
      localProfiles.push(this.globalLocalProfileManager);
    }

    if (options.includeWorkspace) {
      const assistantFiles = await getAllDotContinueDefinitionFiles(
        this.ide,
        options,
        ASSISTANTS,
      );
      const profiles = assistantFiles.map((assistant) => {
        return new LocalProfileLoader(
          this.ide,
          this.ideSettingsPromise,
          this.controlPlaneClient,
          this.llmLogger,
          assistant,
        );
      });
      const localAssistantProfiles = profiles.map(
        (profile) => new ProfileLifecycleManager(profile, this.ide),
      );
      localProfiles.push(...localAssistantProfiles);
    }

    return localProfiles;
  }

  //////////////////
  // External actions that can cause a cascading config refresh
  // Should not be used internally
  //////////////////
  async refreshAll() {
    await this.cascadeInit();
  }

  // Ide settings change: refresh session and cascade refresh from the top
  async updateIdeSettings(ideSettings: IdeSettings) {
    this.ideSettingsPromise = Promise.resolve(ideSettings);
    await this.cascadeInit();
  }

  // Session change: refresh session and cascade refresh from the top
  async updateControlPlaneSessionInfo(
    sessionInfo: ControlPlaneSessionInfo | undefined,
  ) {
    this.controlPlaneClient = new ControlPlaneClient(
      Promise.resolve(sessionInfo),
      this.ideSettingsPromise,
    );
    await this.cascadeInit();
  }

  // Org id: check id validity, save selection, switch and reload
  async setSelectedOrgId(orgId: string, profileId?: string) {
    if (orgId === this.currentOrg.id) {
      return;
    }
    const org = this.organizations.find((org) => org.id === orgId);
    if (!org) {
      throw new Error(`Org ${orgId} not found`);
    }

    const workspaceId = await this.getWorkspaceId();
    const selectedOrgs =
      this.globalContext.get("lastSelectedOrgIdForWorkspace") ?? {};
    this.globalContext.update("lastSelectedOrgIdForWorkspace", {
      ...selectedOrgs,
      [workspaceId]: org.id,
    });

    this.currentOrg = org;

    if (profileId) {
      await this.setSelectedProfileId(profileId);
    } else {
      this.currentProfile = org.currentProfile;
      await this.reloadConfig();
    }
  }

  // Profile id: check id validity, save selection, switch and reload
  async setSelectedProfileId(profileId: string) {
    if (
      this.currentProfile &&
      profileId === this.currentProfile.profileDescription.id
    ) {
      return;
    }
    const profile = this.currentOrg.profiles.find(
      (profile) => profile.profileDescription.id === profileId,
    );
    if (!profile) {
      throw new Error(`Profile ${profileId} not found in current org`);
    }

    const profileKey = await this.getProfileKey(this.currentOrg.id);
    const selectedProfiles =
      this.globalContext.get("lastSelectedProfileForWorkspace") ?? {};
    this.globalContext.update("lastSelectedProfileForWorkspace", {
      ...selectedProfiles,
      [profileKey]: profileId,
    });

    this.currentProfile = profile;
    await this.reloadConfig();
  }

  // Bottom level of cascade: refresh the current profile
  // IMPORTANT - must always refresh when switching profiles
  // Because of e.g. MCP singleton and docs service using things from config
  // Could improve this
  async reloadConfig() {
    if (!this.currentProfile) {
      return {
        config: undefined,
        errors: [],
        configLoadInterrupted: true,
      };
    }

    for (const org of this.organizations) {
      for (const profile of org.profiles) {
        if (
          profile.profileDescription.id !==
          this.currentProfile.profileDescription.id
        ) {
          profile.clearConfig();
        }
      }
    }

    const { config, errors, configLoadInterrupted } =
      await this.currentProfile.reloadConfig(this.additionalContextProviders);

    this.notifyConfigListeners({ config, errors, configLoadInterrupted });
    return { config, errors, configLoadInterrupted };
  }

  // Listeners setup - can listen to current profile updates
  private notifyConfigListeners(result: ConfigResult<ContinueConfig>) {
    for (const listener of this.updateListeners) {
      listener(result);
    }
  }

  private updateListeners: ConfigUpdateFunction[] = [];

  onConfigUpdate(listener: ConfigUpdateFunction) {
    this.updateListeners.push(listener);
  }

  // Methods for loading (without reloading) config
  // Serialized for passing to GUI
  // Load for just awaiting current config load promise for the profile
  async getSerializedConfig(): Promise<
    ConfigResult<BrowserSerializedContinueConfig>
  > {
    if (!this.currentProfile) {
      return {
        config: undefined,
        errors: [],
        configLoadInterrupted: true,
      };
    }
    return await this.currentProfile.getSerializedConfig(
      this.additionalContextProviders,
    );
  }

  async loadConfig(): Promise<ConfigResult<ContinueConfig>> {
    if (!this.currentProfile) {
      return {
        config: undefined,
        errors: [],
        configLoadInterrupted: true,
      };
    }
    const config = await this.currentProfile.loadConfig(
      this.additionalContextProviders,
    );

    if (config.errors?.length) {
      logger.warn("Errors loading config: ", config.errors);
    }
    return config;
  }

  async openConfigProfile(profileId?: string) {
    let openProfileId = profileId || this.currentProfile?.profileDescription.id;
    if (!openProfileId) {
      return;
    }
    const profile = this.currentOrg.profiles.find(
      (p) => p.profileDescription.id === openProfileId,
    );
    if (profile?.profileDescription.profileType === "local") {
      await this.ide.openFile(profile.profileDescription.uri);
    } else {
      const env = await getControlPlaneEnv(this.ide.getIdeSettings());
      await this.ide.openUrl(`${env.APP_URL}${openProfileId}`);
    }
  }

  // Ancient method of adding custom providers through vs code
  private additionalContextProviders: IContextProvider[] = [];
  registerCustomContextProvider(contextProvider: IContextProvider) {
    this.additionalContextProviders.push(contextProvider);
    void this.reloadConfig();
  }
  /**
   * Retrieves the titles of additional context providers that are of type "submenu".
   *
   * @returns {string[]} An array of titles of the additional context providers that have a description type of "submenu".
   */
  getAdditionalSubmenuContextProviders(): string[] {
    return this.additionalContextProviders
      .filter((provider) => provider.description.type === "submenu")
      .map((provider) => provider.description.title);
  }
}
