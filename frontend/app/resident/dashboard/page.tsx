"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  LogOut,
  MessageCircle,
  Share2,
  ShieldAlert,
  Sparkles,
  UserPlus,
} from "lucide-react";
import {
  buildApiPath as makeApiPath,
  buildWsPath,
  resolveBackendBase,
  resolveWsBase,
} from "../../../lib/runtimeConfig";

type VisitorPayload = {
  id: string;
  visitor_name: string;
  visitor_type: string;
  flat_number: string;
  image_payload?: string | null;
  status: string;
  timestamp: string;
};

type WsMessage = {
  event: "connected" | "pong" | "visitor_checked_in" | "visitor_approved" | "visitor_escalated";
  flat_number?: string;
  visitor?: VisitorPayload;
};

type PendingApproval = VisitorPayload & {
  seconds_left: number;
};

type ResidentProfile = {
  flat_number: string;
  resident_name: string;
  phone_number: string | null;
};

type ResidentAuthStorage = {
  accessToken: string;
  expiresAt: string;
  resident: ResidentProfile;
  loginAt: string;
};

type ResidentNotification = {
  id: string;
  visitor_id: string | null;
  event_type: string;
  title: string;
  detail: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

type ResidentSettings = {
  notify_push: boolean;
  notify_whatsapp: boolean;
  statement_preference: "csv" | "json";
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone_name: string;
};

type ResidentDashboardPayload = {
  resident: ResidentProfile;
  pending_approvals: VisitorPayload[];
  unread_notifications: number;
  notifications: ResidentNotification[];
  recent_visitors: VisitorPayload[];
  settings: ResidentSettings;
};

type ResidentNotificationsResponse = {
  unread_count: number;
  notifications: ResidentNotification[];
};

type InviteSeedResponse = {
  visitor_id: string;
};

type AlertLevel = "info" | "success" | "warning";

type ResidentAlert = {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  createdAt: string;
};

const AUTH_STORAGE_KEY = "auragate_resident_auth";
const LEGACY_SESSION_STORAGE_KEY = "auragate_resident_session";

const DEFAULT_SETTINGS: ResidentSettings = {
  notify_push: true,
  notify_whatsapp: false,
  statement_preference: "csv",
  quiet_hours_start: "",
  quiet_hours_end: "",
  timezone_name: "Asia/Kolkata",
};

function secondsLeftFromTimestamp(timestamp: string): number {
  const created = new Date(timestamp).getTime();
  if (Number.isNaN(created)) {
    return 30;
  }
  const elapsed = Math.floor((Date.now() - created) / 1000);
  return Math.max(30 - elapsed, 0);
}

function alertClass(level: AlertLevel): string {
  if (level === "success") {
    return "border-neon-green bg-neon-green/10 text-neon-green";
  }
  if (level === "warning") {
    return "border-danger bg-danger/10 text-danger";
  }
  return "border-navy bg-vintage text-navy";
}

export default function ResidentDashboardPage() {
  const router = useRouter();
  const backendBase = useMemo(() => resolveBackendBase(), []);
  const wsBase = useMemo(() => resolveWsBase(backendBase), [backendBase]);

  const [authReady, setAuthReady] = useState(false);
  const [authSession, setAuthSession] = useState<ResidentAuthStorage | null>(null);

  const residentFlat = authSession?.resident.flat_number ?? "";
  const residentName = authSession?.resident.resident_name ?? "Resident";

  const wsUrl = useMemo(() => {
    if (!residentFlat) {
      return "";
    }
    return buildWsPath(`/ws/resident/${encodeURIComponent(residentFlat)}`, wsBase);
  }, [residentFlat, wsBase]);

  const [connected, setConnected] = useState(false);
  const [statusText, setStatusText] = useState("Listening for gate events...");

  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [approvingId, setApprovingId] = useState<string>("");
  const [recentVisitors, setRecentVisitors] = useState<VisitorPayload[]>([]);

  const [notifications, setNotifications] = useState<ResidentNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [markingReadId, setMarkingReadId] = useState<string>("");
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const [settingsDraft, setSettingsDraft] = useState<ResidentSettings>(DEFAULT_SETTINGS);
  const [savingSettings, setSavingSettings] = useState(false);

  const [exportingFormat, setExportingFormat] = useState<"json" | "csv" | "">("");
  const [photoModal, setPhotoModal] = useState<{ visitorName: string; imagePayload: string } | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestPurpose, setGuestPurpose] = useState("Personal Visit");
  const [inviteId, setInviteId] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [sharing, setSharing] = useState(false);

  const [alerts, setAlerts] = useState<ResidentAlert[]>([]);

  const buildApiPath = useCallback(
    (path: string): string => {
      return makeApiPath(path, backendBase);
    },
    [backendBase],
  );

  const pushAlert = useCallback((level: AlertLevel, title: string, detail: string) => {
    const item: ResidentAlert = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      level,
      title,
      detail,
      createdAt: new Date().toLocaleTimeString(),
    };
    setAlerts((prev) => [item, ...prev].slice(0, 8));
  }, []);

  const refreshNotifications = useCallback(async () => {
    if (!authSession?.accessToken) {
      return;
    }

    try {
      const response = await fetch(buildApiPath("/api/resident/notifications?limit=40"), {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${authSession.accessToken}`,
        },
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as ResidentNotificationsResponse;
      setNotifications(payload.notifications ?? []);
      setUnreadCount(payload.unread_count ?? 0);
    } catch {
      // Keep existing list if refresh fails.
    }
  }, [authSession?.accessToken, buildApiPath]);

  const loadDashboard = useCallback(
    async (surfaceStatus: boolean) => {
      if (!authSession?.accessToken) {
        return;
      }

      try {
        const response = await fetch(buildApiPath("/api/resident/dashboard"), {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${authSession.accessToken}`,
          },
        });

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error("session-expired");
          }
          throw new Error("dashboard-unavailable");
        }

        const payload = (await response.json()) as ResidentDashboardPayload;

        setPendingApprovals(
          (payload.pending_approvals ?? []).map((row) => ({
            ...row,
            seconds_left: secondsLeftFromTimestamp(row.timestamp),
          })),
        );
        setRecentVisitors(payload.recent_visitors ?? []);
        setNotifications(payload.notifications ?? []);
        setUnreadCount(payload.unread_notifications ?? 0);
        setSettingsDraft(payload.settings ?? DEFAULT_SETTINGS);

        setAuthSession((prev) => {
          if (!prev) {
            return prev;
          }
          const next = {
            ...prev,
            resident: payload.resident,
          };
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
          return next;
        });

        if (surfaceStatus) {
          setStatusText("Resident dashboard synced with backend.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "dashboard-unavailable";

        if (message === "session-expired") {
          localStorage.removeItem(AUTH_STORAGE_KEY);
          router.replace("/resident/login");
          return;
        }

        setStatusText("Dashboard API unavailable. Waiting for real-time updates.");
        pushAlert(
          "warning",
          "Dashboard sync failed",
          "Could not fetch resident dashboard data from backend.",
        );
      }
    },
    [authSession?.accessToken, buildApiPath, pushAlert, router],
  );

  useEffect(() => {
    let mounted = true;

    const bootstrapAuth = async () => {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!raw) {
        localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
        router.replace("/resident/login");
        if (mounted) {
          setAuthReady(true);
        }
        return;
      }

      try {
        const parsed = JSON.parse(raw) as ResidentAuthStorage;
        if (!parsed.accessToken) {
          throw new Error("missing-token");
        }

        const response = await fetch(buildApiPath("/api/resident/auth/session"), {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${parsed.accessToken}`,
          },
        });

        if (!response.ok) {
          throw new Error("session-invalid");
        }

        const payload = (await response.json()) as {
          authenticated: boolean;
          resident: ResidentProfile;
          expires_at: string;
        };

        if (!mounted) {
          return;
        }

        const nextSession: ResidentAuthStorage = {
          ...parsed,
          resident: payload.resident,
          expiresAt: payload.expires_at,
        };

        setAuthSession(nextSession);
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession));
        setAuthReady(true);
      } catch {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        router.replace("/resident/login");
        if (mounted) {
          setAuthReady(true);
        }
      }
    };

    void bootstrapAuth();

    return () => {
      mounted = false;
    };
  }, [buildApiPath, router]);

  useEffect(() => {
    if (!authReady || !authSession?.accessToken) {
      return;
    }
    void loadDashboard(true);
  }, [authReady, authSession?.accessToken, loadDashboard]);

  useEffect(() => {
    if (!authReady || !authSession?.accessToken || !residentFlat || !wsUrl) {
      return;
    }

    const socket = new WebSocket(wsUrl);
    let pingIntervalId: number | undefined;

    socket.onopen = () => {
      setConnected(true);
      setStatusText("Secure resident channel connected.");
      pushAlert("success", "Resident channel connected", `Real-time feed active for ${residentFlat}.`);
      pingIntervalId = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send("ping");
        }
      }, 15000);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as WsMessage;

        if (payload.event === "visitor_checked_in" && payload.visitor) {
          const visitor = payload.visitor;
          setPendingApprovals((prev) => {
            if (prev.some((row) => row.id === visitor.id)) {
              return prev;
            }
            return [{ ...visitor, seconds_left: 30 }, ...prev].slice(0, 10);
          });
          setStatusText(`New gate event: ${visitor.visitor_name} is waiting.`);
          pushAlert(
            "warning",
            "Visitor waiting at gate",
            `${visitor.visitor_name} (${visitor.visitor_type}) requested entry for ${visitor.flat_number}.`,
          );
          void refreshNotifications();
        }

        if (payload.event === "visitor_approved" && payload.visitor) {
          const visitor = payload.visitor;
          setPendingApprovals((prev) => prev.filter((row) => row.id !== visitor.id));
          setStatusText(`${visitor.visitor_name} approved and gate notified.`);
          pushAlert("success", "Entry approved", `${visitor.visitor_name} has been approved.`);
          void refreshNotifications();
        }

        if (payload.event === "visitor_escalated" && payload.visitor) {
          const visitor = payload.visitor;
          setPendingApprovals((prev) => prev.filter((row) => row.id !== visitor.id));
          setStatusText(`${visitor.visitor_name} escalated to IVR.`);
          pushAlert(
            "warning",
            "Escalated to IVR",
            `${visitor.visitor_name} crossed timeout and was escalated automatically.`,
          );
          void refreshNotifications();
        }
      } catch {
        setStatusText("Received malformed resident channel message.");
      }
    };

    socket.onclose = () => {
      setConnected(false);
      setStatusText(`Resident channel disconnected (${wsUrl}).`);
      if (pingIntervalId) {
        window.clearInterval(pingIntervalId);
      }
    };

    socket.onerror = () => {
      setStatusText(`WebSocket error. Verify backend at ${wsUrl}.`);
      pushAlert("warning", "WebSocket issue", "Resident channel had a connection problem.");
    };

    return () => {
      if (pingIntervalId) {
        window.clearInterval(pingIntervalId);
      }
      socket.close();
    };
  }, [authReady, authSession?.accessToken, residentFlat, wsUrl, pushAlert, refreshNotifications]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setPendingApprovals((prev) =>
        prev
          .map((row) => ({ ...row, seconds_left: Math.max(row.seconds_left - 1, 0) }))
          .filter((row) => row.seconds_left > 0),
      );
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const approveVisitor = async (visitorId: string) => {
    if (!authSession?.accessToken) {
      return;
    }

    setApprovingId(visitorId);
    try {
      const response = await fetch(buildApiPath(`/api/visitors/${visitorId}/approve`), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${authSession.accessToken}`,
        },
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        const detail =
          typeof (errorPayload as { detail?: string }).detail === "string"
            ? (errorPayload as { detail: string }).detail
            : "Approval failed.";
        throw new Error(detail);
      }

      const payload = (await response.json()) as { visitor: VisitorPayload };
      setPendingApprovals((prev) => prev.filter((row) => row.id !== visitorId));
      setStatusText(`${payload.visitor.visitor_name} approved successfully.`);
      pushAlert("success", "Approval sent", `${payload.visitor.visitor_name} can now enter through the gate.`);
      void refreshNotifications();
      void loadDashboard(false);
    } catch (error) {
      if (error instanceof TypeError) {
        const baseHint = backendBase || "http://127.0.0.1:8001";
        setStatusText(`Backend unreachable for approval. Expected: ${baseHint}`);
        pushAlert("warning", "Approval failed", "Backend was unreachable while approving visitor.");
      } else {
        const message = error instanceof Error ? error.message : "Unexpected approval failure.";
        setStatusText(message);
        pushAlert("warning", "Approval failed", message);
      }
    } finally {
      setApprovingId("");
    }
  };

  const markNotificationRead = async (notificationId: string) => {
    if (!authSession?.accessToken) {
      return;
    }

    setMarkingReadId(notificationId);
    try {
      const response = await fetch(buildApiPath(`/api/resident/notifications/${notificationId}/read`), {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${authSession.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Unable to mark notification.");
      }

      const updated = (await response.json()) as ResidentNotification;
      setNotifications((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setUnreadCount((prev) => Math.max(prev - 1, 0));
    } catch {
      pushAlert("warning", "Action failed", "Unable to mark this notification as read.");
    } finally {
      setMarkingReadId("");
    }
  };

  const markAllNotificationsRead = async () => {
    if (!authSession?.accessToken || unreadCount === 0) {
      return;
    }

    setMarkingAllRead(true);
    try {
      const response = await fetch(buildApiPath("/api/resident/notifications/read-all"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authSession.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Unable to mark notifications as read.");
      }

      setNotifications((prev) =>
        prev.map((item) => ({
          ...item,
          is_read: true,
          read_at: item.read_at ?? new Date().toISOString(),
        })),
      );
      setUnreadCount(0);
      pushAlert("success", "Notifications cleared", "All missed notifications marked as read.");
    } catch {
      pushAlert("warning", "Action failed", "Unable to mark all notifications as read.");
    } finally {
      setMarkingAllRead(false);
    }
  };

  const saveSettings = async () => {
    if (!authSession?.accessToken) {
      return;
    }

    setSavingSettings(true);
    try {
      const response = await fetch(buildApiPath("/api/resident/settings"), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authSession.accessToken}`,
        },
        body: JSON.stringify(settingsDraft),
      });

      if (!response.ok) {
        throw new Error("Unable to save settings");
      }

      const payload = (await response.json()) as ResidentSettings;
      setSettingsDraft(payload);
      pushAlert("success", "Settings saved", "Resident settings updated successfully.");
    } catch {
      pushAlert("warning", "Settings failed", "Could not update resident settings right now.");
    } finally {
      setSavingSettings(false);
    }
  };

  const exportVisitStatement = async (format: "json" | "csv") => {
    if (!authSession?.accessToken) {
      return;
    }

    setExportingFormat(format);
    try {
      const response = await fetch(buildApiPath(`/api/resident/visit-statement?format=${format}&limit=250`), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authSession.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Unable to export statement");
      }

      const blob = await response.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      link.href = objectUrl;
      link.download = `auragate-statement-${residentFlat}-${stamp}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
      pushAlert("success", "Statement exported", `Downloaded ${format.toUpperCase()} statement.`);
    } catch {
      pushAlert("warning", "Export failed", "Unable to export visit statement right now.");
    } finally {
      setExportingFormat("");
    }
  };

  const generateInvite = async () => {
    const normalizedGuest = guestName.trim();
    if (!normalizedGuest) {
      setInviteError("Guest name is required before generating an invite.");
      return;
    }

    setGeneratingInvite(true);
    setInviteError("");

    try {
      const params = new URLSearchParams({
        guest_name: normalizedGuest,
        flat_number: residentFlat,
      });
      const response = await fetch(buildApiPath(`/api/totp/generate?${params.toString()}`), {
        method: "GET",
        cache: "no-store",
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(
          typeof errorPayload?.detail === "string"
            ? errorPayload.detail
            : `Invite generation failed (HTTP ${response.status}).`,
        );
      }

      const payload = (await response.json()) as InviteSeedResponse;
      if (!payload.visitor_id) {
        throw new Error("Invite generation returned an invalid visitor id.");
      }

      const origin = window.location.origin;
      const linkParams = new URLSearchParams({
        purpose: guestPurpose.trim() || "Personal Visit",
      });
      const generatedLink = `${origin}/invite/${payload.visitor_id}?${linkParams.toString()}`;

      setInviteId(payload.visitor_id);
      setInviteLink(generatedLink);
      setCopyDone(false);
      pushAlert("info", "Secure invite generated", `${normalizedGuest} can now open the secure visitor pass link.`);
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "Unable to generate invite right now.");
    } finally {
      setGeneratingInvite(false);
    }
  };

  const shareInviteViaWhatsApp = () => {
    if (!inviteLink) {
      return;
    }
    const text = `Here is your secure AuraGate pass for Flat ${residentFlat}:${inviteLink}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const copyInviteLink = async () => {
    if (!inviteLink || !("clipboard" in navigator)) {
      return;
    }

    await navigator.clipboard.writeText(inviteLink);
    setCopyDone(true);
    pushAlert("success", "Invite copied", "Secure guest pass link copied to clipboard.");
  };

  const shareInviteAnywhere = async () => {
    if (!inviteLink) {
      return;
    }

    setSharing(true);
    try {
      if (navigator.share) {
        await navigator.share({
          title: "AuraGate Secure Visitor Pass",
          text: `Secure pass for Flat ${residentFlat}`,
          url: inviteLink,
        });
        pushAlert("success", "Invite shared", "Invite shared using system share sheet.");
      } else {
        await copyInviteLink();
      }
    } catch {
      pushAlert("warning", "Share canceled", "Invite share was canceled before completion.");
    } finally {
      setSharing(false);
    }
  };

  const logoutResident = () => {
    const accessToken = authSession?.accessToken;
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);

    if (accessToken) {
      void fetch(buildApiPath("/api/resident/auth/logout"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }).catch(() => {
        // Ignore logout API errors while redirecting.
      });
    }

    router.replace("/resident/login");
  };

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-vintage px-4 text-navy font-mono">
        <p className="border-4 border-navy bg-white px-4 py-3 text-sm font-bold shadow-offset-safety">
          Loading resident session...
        </p>
      </main>
    );
  }

  if (!authSession || !residentFlat) {
    return null;
  }

  return (
    <main className="min-h-screen bg-vintage px-4 py-6 text-navy font-mono">
      <section className="mx-auto w-full max-w-7xl space-y-6">
        <header className="border-4 border-navy bg-white p-5 shadow-offset-safety">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-navy/70">Resident Console</p>
              <h1 className="mt-2 text-3xl font-black uppercase tracking-wide">{residentName}</h1>
              <p className="mt-1 text-xs font-bold uppercase tracking-wider text-navy/70">Flat {residentFlat}</p>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-safety" />
              <button
                type="button"
                onClick={logoutResident}
                className="inline-flex items-center gap-1 border-2 border-navy bg-white px-3 py-1 text-xs font-black uppercase tracking-wider hover:bg-navy hover:text-white"
              >
                <LogOut className="h-3.5 w-3.5" />
                Logout
              </button>
            </div>
          </div>
          <p className="mt-2 text-sm font-semibold text-navy/80">Live alerts, secure guest invites, and resident action controls.</p>
          <div className="mt-4 inline-flex items-center gap-2 border-2 border-navy bg-vintage px-3 py-1 text-xs font-black uppercase tracking-wide">
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-neon-green" : "bg-neon-red"}`} />
            {connected ? "Live resident channel connected" : "Channel reconnecting"}
          </div>
          <p className="mt-2 text-xs font-bold uppercase tracking-wider text-navy/70">Missed notifications: {unreadCount}</p>
        </header>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="border-4 border-navy bg-white p-4 shadow-offset-navy">
            <div className="mb-3 flex items-center gap-2">
              <BellRing className="h-5 w-5 text-navy" />
              <h2 className="text-lg font-black uppercase tracking-wider">Pending Approvals</h2>
            </div>

            {pendingApprovals.length === 0 ? (
              <p className="border-2 border-navy bg-vintage p-3 text-sm font-bold">
                No pending visitors right now.
              </p>
            ) : (
              <div className="space-y-3">
                {pendingApprovals.map((visitor) => (
                  <article
                    key={visitor.id}
                    className="border-2 border-navy bg-vintage p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black uppercase tracking-wider">{visitor.visitor_name}</p>
                        <p className="text-xs font-bold uppercase tracking-wider text-navy/70">{visitor.visitor_type}</p>
                      </div>
                      <div className="inline-flex items-center gap-1 border-2 border-navy bg-white px-2 py-1 text-xs font-black uppercase tracking-wider">
                        <Clock3 className="h-3.5 w-3.5" />
                        <span>{visitor.seconds_left}s</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={approvingId === visitor.id}
                      onClick={() => void approveVisitor(visitor.id)}
                      className="mt-3 w-full border-2 border-navy bg-navy px-4 py-2.5 text-sm font-black uppercase tracking-wider text-white transition hover:bg-safety disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="inline-flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        {approvingId === visitor.id ? "Approving..." : "Approve"}
                      </span>
                    </button>
                    <p className="mt-1.5 text-center text-[11px] font-bold uppercase tracking-wider text-navy/70">(Long-press for SOS/Duress)</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="border-4 border-navy bg-white p-4 shadow-offset-navy">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-navy" />
              <h2 className="text-lg font-black uppercase tracking-wider">Missed Notifications</h2>
            </div>

            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider">Unread: {unreadCount}</p>
              <button
                type="button"
                disabled={markingAllRead || unreadCount === 0}
                onClick={() => void markAllNotificationsRead()}
                className="border-2 border-navy bg-white px-2 py-1 text-[11px] font-black uppercase tracking-wider hover:bg-navy hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {markingAllRead ? "Clearing..." : "Mark all as read"}
              </button>
            </div>

            {notifications.length === 0 ? (
              <p className="border-2 border-navy bg-vintage p-3 text-sm font-bold">
                No notifications yet. New gate actions will appear here.
              </p>
            ) : (
              <div className="space-y-2">
                {notifications.map((item) => (
                  <article
                    key={item.id}
                    className={`border-2 px-3 py-2 text-xs ${item.is_read ? "border-navy bg-vintage text-navy" : "border-navy bg-white text-navy"}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-black uppercase tracking-wider">{item.title}</p>
                      <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{new Date(item.created_at).toLocaleTimeString()}</span>
                    </div>
                    <p className="mt-1 font-semibold opacity-90">{item.detail}</p>
                    {!item.is_read ? (
                      <button
                        type="button"
                        disabled={markingReadId === item.id}
                        onClick={() => void markNotificationRead(item.id)}
                        className="mt-2 border-2 border-navy px-2 py-1 text-[11px] font-black uppercase tracking-wider hover:bg-navy hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {markingReadId === item.id ? "Updating..." : "Mark read"}
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="border-4 border-navy bg-white p-4 shadow-offset-navy">
            <div className="mb-3 flex items-center gap-2">
              <Download className="h-5 w-5 text-navy" />
              <h2 className="text-lg font-black uppercase tracking-wider">Visit Logs & Statement Export</h2>
            </div>

            <button
              type="button"
              disabled={exportingFormat !== ""}
              onClick={() => void exportVisitStatement("csv")}
              className="mb-3 inline-flex w-full items-center justify-center gap-2 border-2 border-navy bg-navy px-3 py-2 text-sm font-black uppercase tracking-wider text-white hover:bg-safety disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {exportingFormat === "csv" ? "Downloading..." : "Download History"}
            </button>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={exportingFormat !== ""}
                onClick={() => void exportVisitStatement("json")}
                className="col-span-2 border-2 border-navy bg-white px-3 py-2 text-sm font-black uppercase tracking-wider hover:bg-navy hover:text-white disabled:opacity-60"
              >
                {exportingFormat === "json" ? "Exporting..." : "Download JSON"}
              </button>
            </div>

            {recentVisitors.length === 0 ? (
              <p className="border-2 border-navy bg-vintage p-3 text-sm font-bold">
                No visit logs available yet.
              </p>
            ) : (
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {recentVisitors.slice(0, 8).map((row) => (
                  <article key={row.id} className="border-2 border-navy bg-vintage px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-black uppercase tracking-wider">{row.visitor_name}</p>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-navy/70">{new Date(row.timestamp).toLocaleDateString()}</span>
                    </div>
                    <p className="mt-0.5 font-semibold uppercase tracking-wider text-navy/70">
                      {row.visitor_type} • {row.status}
                    </p>
                    {row.image_payload ? (
                      <button
                        type="button"
                        onClick={() => setPhotoModal({ visitorName: row.visitor_name, imagePayload: row.image_payload ?? "" })}
                        className="mt-2 border-2 border-navy bg-white px-2 py-1 text-[11px] font-black uppercase tracking-wider hover:bg-navy hover:text-white"
                      >
                        View Photo
                      </button>
                    ) : (
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-navy/60">No photo</p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="border-4 border-navy bg-white p-4 shadow-offset-navy">
            <h2 className="text-lg font-black uppercase tracking-wider">Resident Settings</h2>
            <div className="mt-3 grid gap-3 text-sm">
              <label className="flex items-center justify-between border-2 border-navy bg-vintage px-3 py-2">
                <span className="font-black uppercase tracking-wider">Push Notifications</span>
                <input
                  type="checkbox"
                  checked={settingsDraft.notify_push}
                  onChange={(event) => setSettingsDraft((prev) => ({ ...prev, notify_push: event.target.checked }))}
                  className="h-4 w-4 accent-navy"
                />
              </label>

              <label className="flex items-center justify-between border-2 border-navy bg-vintage px-3 py-2">
                <span className="font-black uppercase tracking-wider">WhatsApp Alerts</span>
                <input
                  type="checkbox"
                  checked={settingsDraft.notify_whatsapp}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({ ...prev, notify_whatsapp: event.target.checked }))
                  }
                  className="h-4 w-4 accent-navy"
                />
              </label>

              <label className="grid gap-1.5 border-2 border-navy bg-vintage px-3 py-2">
                <span className="font-black uppercase tracking-wider">Statement Format</span>
                <select
                  value={settingsDraft.statement_preference}
                  onChange={(event) =>
                    setSettingsDraft((prev) => ({
                      ...prev,
                      statement_preference: event.target.value as "csv" | "json",
                    }))
                  }
                  className="border-2 border-navy bg-white px-2 py-1.5 font-bold outline-none"
                >
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </select>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1.5 border-2 border-navy bg-vintage px-3 py-2">
                  <span className="font-black uppercase tracking-wider">Quiet Start</span>
                  <input
                    value={settingsDraft.quiet_hours_start ?? ""}
                    onChange={(event) =>
                      setSettingsDraft((prev) => ({ ...prev, quiet_hours_start: event.target.value }))
                    }
                    placeholder="22:00"
                    className="border-2 border-navy bg-white px-2 py-1.5 font-bold outline-none"
                  />
                </label>

                <label className="grid gap-1.5 border-2 border-navy bg-vintage px-3 py-2">
                  <span className="font-black uppercase tracking-wider">Quiet End</span>
                  <input
                    value={settingsDraft.quiet_hours_end ?? ""}
                    onChange={(event) =>
                      setSettingsDraft((prev) => ({ ...prev, quiet_hours_end: event.target.value }))
                    }
                    placeholder="06:00"
                    className="border-2 border-navy bg-white px-2 py-1.5 font-bold outline-none"
                  />
                </label>
              </div>

              <button
                type="button"
                disabled={savingSettings}
                onClick={() => void saveSettings()}
                className="border-2 border-navy bg-navy px-3 py-2 text-sm font-black uppercase tracking-wider text-white hover:bg-safety disabled:opacity-60"
              >
                {savingSettings ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </section>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="border-4 border-navy bg-white p-4 shadow-offset-navy">
            <h2 className="text-lg font-black uppercase tracking-wider">Live Alert Stream</h2>
            {alerts.length === 0 ? (
              <p className="mt-3 border-2 border-navy bg-vintage p-3 text-sm font-bold">
                No live stream events yet.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {alerts.map((alert) => (
                  <article
                    key={alert.id}
                    className={`border-2 px-3 py-2 text-xs ${alertClass(alert.level)}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-black uppercase tracking-wider">{alert.title}</p>
                      <span className="text-[10px] font-bold uppercase tracking-wider opacity-80">{alert.createdAt}</span>
                    </div>
                    <p className="mt-1 font-semibold opacity-90">{alert.detail}</p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="w-full border-4 border-navy bg-white px-5 py-5 text-left shadow-offset-navy transition hover:bg-vintage"
          >
            <span className="inline-flex items-center gap-2 text-navy">
              <UserPlus className="h-5 w-5" />
              <span className="text-xl font-black uppercase tracking-wider">Invite Guest</span>
            </span>
            <p className="mt-1 text-sm font-semibold text-navy/80">Share secure guest pass links through WhatsApp or any app.</p>
          </button>
        </div>

        <p className="border-2 border-navy bg-white px-3 py-2 text-xs font-black uppercase tracking-wider">{statusText}</p>
      </section>

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/80 p-4 sm:items-center">
          <section className="w-full max-w-md border-4 border-navy bg-vintage p-5 shadow-offset-safety">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xl font-black uppercase tracking-wider text-navy">Create Guest Invite</h3>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="border-2 border-navy bg-white px-2.5 py-1 text-xs font-black uppercase tracking-wider text-navy hover:bg-navy hover:text-white"
              >
                Close
              </button>
            </div>

            <label className="mt-4 grid gap-1.5 text-sm">
              <span className="font-black uppercase tracking-wider text-navy">Guest Name</span>
              <input
                value={guestName}
                onChange={(event) => {
                  setGuestName(event.target.value);
                  setInviteError("");
                }}
                placeholder="e.g., Aarav Sharma"
                className="border-2 border-navy bg-white px-3 py-2.5 font-bold text-navy outline-none focus:ring-4 focus:ring-safety/40"
              />
            </label>

            <label className="mt-3 grid gap-1.5 text-sm">
              <span className="font-black uppercase tracking-wider text-navy">Purpose</span>
              <input
                value={guestPurpose}
                onChange={(event) => setGuestPurpose(event.target.value)}
                placeholder="Delivery / Personal Visit / Maid"
                className="border-2 border-navy bg-white px-3 py-2.5 font-bold text-navy outline-none focus:ring-4 focus:ring-safety/40"
              />
            </label>

            {inviteError ? (
              <p className="mt-3 border-2 border-danger bg-danger/10 px-3 py-2 text-xs font-bold text-danger">
                {inviteError}
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void generateInvite()}
              disabled={generatingInvite}
              className="mt-4 w-full border-2 border-navy bg-navy px-3 py-2.5 text-sm font-black uppercase tracking-wider text-white hover:bg-safety"
            >
              {generatingInvite ? "Generating..." : "Generate Secure Link"}
            </button>

            {inviteLink && (
              <div className="mt-4 space-y-3 border-2 border-navy bg-white p-3">
                <p className="break-all text-xs font-bold text-navy">{inviteLink}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={shareInviteViaWhatsApp}
                    className="inline-flex items-center justify-center gap-2 border-2 border-navy bg-white px-3 py-2 text-sm font-black uppercase tracking-wider text-navy hover:bg-navy hover:text-white"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Share on WhatsApp
                  </button>

                  <button
                    type="button"
                    disabled={sharing}
                    onClick={() => void shareInviteAnywhere()}
                    className="inline-flex items-center justify-center gap-2 border-2 border-navy bg-white px-3 py-2 text-sm font-black uppercase tracking-wider text-navy hover:bg-navy hover:text-white disabled:opacity-60"
                  >
                    <Share2 className="h-4 w-4" />
                    {sharing ? "Sharing..." : "Share Anywhere"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void copyInviteLink()}
                    className="inline-flex items-center justify-center gap-2 border-2 border-navy bg-white px-3 py-2 text-sm font-black uppercase tracking-wider text-navy hover:bg-navy hover:text-white"
                  >
                    <Copy className="h-4 w-4" />
                    {copyDone ? "Copied" : "Copy Link"}
                  </button>

                  <Link
                    href={
                      inviteId
                        ? `/invite/${inviteId}?purpose=${encodeURIComponent(guestPurpose)}`
                        : "/resident/dashboard"
                    }
                    className="inline-flex items-center justify-center gap-2 border-2 border-navy bg-white px-3 py-2 text-sm font-black uppercase tracking-wider text-navy hover:bg-navy hover:text-white"
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Preview Pass
                  </Link>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {photoModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-navy/85 p-4">
          <section className="w-full max-w-md border-4 border-navy bg-vintage p-4 shadow-offset-safety">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-black uppercase tracking-wider text-navy">{photoModal.visitorName}</h3>
              <button
                type="button"
                onClick={() => setPhotoModal(null)}
                className="border-2 border-navy bg-white px-2.5 py-1 text-xs font-black uppercase tracking-wider text-navy hover:bg-navy hover:text-white"
              >
                Close
              </button>
            </div>
            <img
              src={photoModal.imagePayload}
              alt={`${photoModal.visitorName} captured`}
              className="mt-3 max-h-[75vh] w-full border-2 border-navy object-contain bg-white"
            />
          </section>
        </div>
      )}
    </main>
  );
}
