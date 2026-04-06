import type { ButtonInteraction, ComponentData } from "@buape/carbon";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockResolveApprovalOverGateway = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/approval-handler-runtime", async () => {
  const actual = await vi.importActual<
    typeof import("openclaw/plugin-sdk/approval-handler-runtime")
  >("openclaw/plugin-sdk/approval-handler-runtime");
  return {
    ...actual,
    resolveApprovalOverGateway: mockResolveApprovalOverGateway,
  };
});

let buildExecApprovalCustomId: typeof import("./exec-approvals.js").buildExecApprovalCustomId;
let createDiscordExecApprovalButtonContext: typeof import("./exec-approvals.js").createDiscordExecApprovalButtonContext;
let createExecApprovalButton: typeof import("./exec-approvals.js").createExecApprovalButton;
let extractDiscordChannelId: typeof import("./exec-approvals.js").extractDiscordChannelId;
let parseExecApprovalData: typeof import("./exec-approvals.js").parseExecApprovalData;
let ExecApprovalButton: typeof import("./exec-approvals.js").ExecApprovalButton;

beforeAll(async () => {
  ({
    buildExecApprovalCustomId,
    createDiscordExecApprovalButtonContext,
    createExecApprovalButton,
    extractDiscordChannelId,
    parseExecApprovalData,
    ExecApprovalButton,
  } = await import("./exec-approvals.js"));
});

beforeEach(() => {
  mockResolveApprovalOverGateway.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildExecApprovalCustomId", () => {
  it("encodes approval id and action", () => {
    expect(buildExecApprovalCustomId("abc-123", "allow-once")).toBe(
      "execapproval:id=abc-123;action=allow-once",
    );
  });

  it("encodes special characters in approval id", () => {
    expect(buildExecApprovalCustomId("abc=123;test", "deny")).toBe(
      "execapproval:id=abc%3D123%3Btest;action=deny",
    );
  });
});

describe("parseExecApprovalData", () => {
  it("parses valid encoded data", () => {
    expect(parseExecApprovalData({ id: "abc%3D123%3Btest", action: "allow-always" })).toEqual({
      approvalId: "abc=123;test",
      action: "allow-always",
    });
  });

  it("rejects invalid shapes", () => {
    expect(parseExecApprovalData({ id: "abc", action: "invalid" })).toBeNull();
    expect(parseExecApprovalData({ id: "abc" })).toBeNull();
    expect(parseExecApprovalData({ action: "deny" })).toBeNull();
    expect(parseExecApprovalData(null as unknown as ComponentData)).toBeNull();
  });
});

describe("extractDiscordChannelId", () => {
  it("extracts channel ids from discord session keys", () => {
    expect(extractDiscordChannelId("agent:main:discord:channel:123456789")).toBe("123456789");
    expect(extractDiscordChannelId("agent:main:discord:group:987654321")).toBe("987654321");
  });

  it("rejects non-discord or malformed session keys", () => {
    expect(extractDiscordChannelId("agent:main:telegram:channel:123456789")).toBeNull();
    expect(extractDiscordChannelId("agent:main:discord:dm:123456789")).toBeNull();
    expect(extractDiscordChannelId(null)).toBeNull();
  });
});

type MockInteraction = Pick<ButtonInteraction, "acknowledge" | "followUp" | "reply" | "userId">;

function createInteraction(overrides: Partial<MockInteraction> = {}): ButtonInteraction {
  return {
    acknowledge: vi.fn(async () => undefined),
    followUp: vi.fn(async () => undefined),
    reply: vi.fn(async () => undefined),
    userId: "123",
    ...overrides,
  } as ButtonInteraction;
}

describe("ExecApprovalButton", () => {
  it("rejects invalid payloads", async () => {
    const interaction = createInteraction();
    const button = new ExecApprovalButton({
      getApprovers: () => ["123"],
      resolveApproval: vi.fn(async () => true),
    });

    await button.run(interaction, {} as ComponentData);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "This approval is no longer valid.",
      ephemeral: true,
    });
  });

  it("rejects unauthorized users", async () => {
    const interaction = createInteraction({ userId: "999" });
    const resolveApproval = vi.fn(async () => true);
    const button = new ExecApprovalButton({
      getApprovers: () => ["123"],
      resolveApproval,
    });

    await button.run(interaction, { id: "approval-1", action: "allow-once" });

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "⛔ You are not authorized to approve exec requests.",
      ephemeral: true,
    });
    expect(resolveApproval).not.toHaveBeenCalled();
  });

  it("acknowledges and resolves valid approval clicks", async () => {
    const interaction = createInteraction();
    const resolveApproval = vi.fn(async () => true);
    const button = new ExecApprovalButton({
      getApprovers: () => ["123"],
      resolveApproval,
    });

    await button.run(interaction, { id: "approval-1", action: "allow-always" });

    expect(interaction.acknowledge).toHaveBeenCalled();
    expect(resolveApproval).toHaveBeenCalledWith("approval-1", "allow-always");
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it("reports gateway failures after acknowledging", async () => {
    const interaction = createInteraction();
    const button = new ExecApprovalButton({
      getApprovers: () => ["123"],
      resolveApproval: vi.fn(async () => false),
    });

    await button.run(interaction, { id: "approval-1", action: "deny" });

    expect(interaction.acknowledge).toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith({
      content:
        "Failed to submit approval decision for **Denied**. The request may have expired or already been resolved.",
      ephemeral: true,
    });
  });
});

describe("createExecApprovalButton", () => {
  it("creates an exec approval button instance", () => {
    const button = createExecApprovalButton({
      getApprovers: () => [],
      resolveApproval: vi.fn(async () => true),
    });

    expect(button).toBeInstanceOf(ExecApprovalButton);
  });
});

describe("createDiscordExecApprovalButtonContext", () => {
  it("resolves approvers from discord config", () => {
    const context = createDiscordExecApprovalButtonContext({
      cfg: {},
      accountId: "default",
      config: { enabled: true, approvers: ["123", "456"] },
    });

    expect(context.getApprovers()).toEqual(["123", "456"]);
  });

  it("forwards approval resolution through the gateway helper", async () => {
    const context = createDiscordExecApprovalButtonContext({
      cfg: { gateway: { auth: { token: "cfg-token" } } },
      accountId: "default",
      config: { enabled: true, approvers: ["123"] },
      gatewayUrl: "ws://gateway.example.test",
    });

    await expect(context.resolveApproval("approval-1", "allow-once")).resolves.toBe(true);
    expect(mockResolveApprovalOverGateway).toHaveBeenCalledWith({
      approvalId: "approval-1",
      cfg: { gateway: { auth: { token: "cfg-token" } } },
      clientDisplayName: "Discord approval (default)",
      decision: "allow-once",
      gatewayUrl: "ws://gateway.example.test",
    });
  });

  it("returns false when gateway resolution throws", async () => {
    mockResolveApprovalOverGateway.mockRejectedValueOnce(new Error("boom"));
    const context = createDiscordExecApprovalButtonContext({
      cfg: {},
      accountId: "default",
      config: { enabled: true, approvers: ["123"] },
    });

    await expect(context.resolveApproval("approval-1", "deny")).resolves.toBe(false);
  });
});
