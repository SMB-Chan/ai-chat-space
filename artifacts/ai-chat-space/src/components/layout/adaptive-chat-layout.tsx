import { useCallback, useMemo, useState } from "react";
import { useListOpenaiConversations } from "@workspace/api-client-react";
import { useClerk, useUser } from "@clerk/react";
import { useLocation, useParams } from "wouter";
import {
  ArrowUp,
  BriefcaseBusiness,
  ChevronRight,
  Github,
  Laptop,
  LogOut,
  Menu,
  MessageSquareText,
  Mic,
  Plus,
  Settings,
  Shield,
  X,
} from "lucide-react";
import { ChatLayout } from "./chat-layout";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import "./chatgpt-mobile.css";

interface AdaptiveChatLayoutProps {
  children: React.ReactNode;
}

type MobileMode = "chat" | "work";

function workIconForTitle(title: string) {
  if (/github|git\b|repo|repository|pr\b|pull request/i.test(title)) {
    return Github;
  }
  return Laptop;
}

export function AdaptiveChatLayout({ children }: AdaptiveChatLayoutProps) {
  const isMobile = useIsMobile();
  const [location, setLocation] = useLocation();
  const params = useParams();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { data: conversations, isLoading } = useListOpenaiConversations();
  const [mode, setMode] = useState<MobileMode>("chat");
  const [menuOpen, setMenuOpen] = useState(false);

  const activeId = params.id ? Number.parseInt(params.id, 10) : null;
  const recentWork = useMemo(
    () => (conversations ?? []).slice(0, 5),
    [conversations],
  );

  const openChat = useCallback(
    (path = "/chat") => {
      setMode("chat");
      setMenuOpen(false);
      setLocation(path);
    },
    [setLocation],
  );

  const focusComposer = useCallback(() => {
    openChat("/chat");
    window.setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>("[data-testid='composer-textarea']")
        ?.focus();
    }, 90);
  }, [openChat]);

  if (!isMobile) {
    return <ChatLayout>{children}</ChatLayout>;
  }

  return (
    <div className="chatgpt-mobile-shell">
      <ChatLayout>{children}</ChatLayout>

      <header
        className="chatgpt-mobile-topbar"
        aria-label="モバイルナビゲーション"
      >
        <button
          type="button"
          className="chatgpt-mobile-menu-button"
          onClick={() => setMenuOpen(true)}
          aria-label="メニューを開く"
        >
          <Menu aria-hidden="true" />
        </button>

        <div
          className="chatgpt-mobile-segment"
          role="tablist"
          aria-label="表示モード"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "chat"}
            className={cn(mode === "chat" && "is-active")}
            onClick={() => setMode("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "work"}
            className={cn(mode === "work" && "is-active")}
            onClick={() => setMode("work")}
          >
            Work
          </button>
        </div>
      </header>

      {mode === "work" && (
        <section className="chatgpt-work-panel" aria-label="Work">
          <div className="chatgpt-work-list" role="list">
            {isLoading ? (
              <div className="chatgpt-work-empty">
                作業履歴を読み込んでいます…
              </div>
            ) : recentWork.length > 0 ? (
              recentWork.map((conversation) => {
                const Icon = workIconForTitle(conversation.title ?? "");
                return (
                  <button
                    key={conversation.id}
                    type="button"
                    role="listitem"
                    className="chatgpt-work-item"
                    onClick={() =>
                      openChat(`/conversations/${conversation.id}`)
                    }
                  >
                    <span className="chatgpt-work-icon" aria-hidden="true">
                      <Icon />
                    </span>
                    <span className="chatgpt-work-title">
                      {conversation.title || "無題の作業"}
                    </span>
                    <ChevronRight
                      className="chatgpt-work-chevron"
                      aria-hidden="true"
                    />
                  </button>
                );
              })
            ) : (
              <div className="chatgpt-work-empty">
                <BriefcaseBusiness aria-hidden="true" />
                <p>まだ作業履歴はありません。</p>
                <span>Chat から始めた会話がここに並びます。</span>
              </div>
            )}
          </div>

          <button
            type="button"
            className="chatgpt-work-composer"
            onClick={focusComposer}
            aria-label="Chatで新しい作業を始める"
          >
            <span className="chatgpt-work-placeholder">ChatGPT と作業する</span>
            <span className="chatgpt-work-composer-row">
              <span className="chatgpt-work-plus" aria-hidden="true">
                <Plus />
              </span>
              <span className="chatgpt-work-model">AI Space</span>
              <span className="chatgpt-work-mic" aria-hidden="true">
                <Mic />
              </span>
              <span className="chatgpt-work-send" aria-hidden="true">
                <ArrowUp />
              </span>
            </span>
          </button>
        </section>
      )}

      {menuOpen && (
        <div className="chatgpt-mobile-menu-layer" role="presentation">
          <button
            type="button"
            className="chatgpt-mobile-menu-backdrop"
            aria-label="メニューを閉じる"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="chatgpt-mobile-menu" aria-label="メインメニュー">
            <div className="chatgpt-mobile-menu-head">
              <div>
                <strong>AI Space</strong>
                <span>{user?.firstName || "Workspace"}</span>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="メニューを閉じる"
              >
                <X />
              </button>
            </div>

            <nav className="chatgpt-mobile-menu-actions">
              <button type="button" onClick={() => openChat("/chat")}>
                <Plus />
                <span>新しい会話</span>
              </button>
              <button type="button" onClick={() => openChat("/private")}>
                <Shield />
                <span>プライベート</span>
              </button>
              <button
                type="button"
                className={cn(location === "/settings" && "is-active")}
                onClick={() => openChat("/settings")}
              >
                <Settings />
                <span>設定</span>
              </button>
            </nav>

            <div className="chatgpt-mobile-menu-history">
              <div className="chatgpt-mobile-menu-label">会話履歴</div>
              {isLoading ? (
                <div className="chatgpt-mobile-menu-muted">読み込み中…</div>
              ) : (conversations ?? []).length > 0 ? (
                (conversations ?? []).slice(0, 20).map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    className={cn(activeId === conversation.id && "is-active")}
                    onClick={() =>
                      openChat(`/conversations/${conversation.id}`)
                    }
                  >
                    <MessageSquareText />
                    <span>{conversation.title || "無題"}</span>
                  </button>
                ))
              ) : (
                <div className="chatgpt-mobile-menu-muted">
                  まだ会話はありません
                </div>
              )}
            </div>

            <button
              type="button"
              className="chatgpt-mobile-logout"
              onClick={() =>
                signOut({ redirectUrl: import.meta.env.BASE_URL || "/" })
              }
            >
              <LogOut />
              <span>ログアウト</span>
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
