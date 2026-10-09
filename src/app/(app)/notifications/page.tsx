import { Bell } from "lucide-react";
import type { Metadata } from "next";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read-button";
import { NotificationItem } from "@/components/notifications/notification-item";
import { EmptyState, PageHeader, Section } from "@/components/shared/page";
import { getDb } from "@/db/client";
import { isStaff } from "@/lib/domain";
import { formatRelative, pluralize } from "@/lib/format";
import { requireUser } from "@/server/auth/session";
import { countUnreadNotifications, listNotifications } from "@/server/queries/misc";

export const metadata: Metadata = { title: "Notificaciones" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const db = await getDb();
  const now = new Date();

  // The list is capped, so the unread total is counted separately.
  const [notifications, unread] = await Promise.all([
    listNotifications(db, user.id),
    countUnreadNotifications(db, user.id),
  ]);
  const staff = isStaff(user.role);

  const groups = [
    { title: "Nuevas", items: notifications.filter((n) => !n.readAt) },
    { title: "Anteriores", items: notifications.filter((n) => n.readAt) },
  ].filter((group) => group.items.length > 0);

  return (
    <>
      <PageHeader
        title="Notificaciones"
        description={unread > 0 ? `Tienes ${pluralize(unread, "notificación", "notificaciones")} sin leer.` : "Estás al día."}
        actions={<MarkAllReadButton disabled={unread === 0} />}
      />

      {groups.length === 0 ? (
        <Section flush>
          <EmptyState
            icon={Bell}
            title="Aún no tienes notificaciones"
            description="Aquí aparecerán las novedades sobre la actividad y la seguridad de tu perfil."
          />
        </Section>
      ) : (
        <div className="grid gap-6">
          {groups.map((group) => (
            <Section key={group.title} title={group.title} flush className="overflow-hidden">
              <ul className="divide-y divide-border/70 border-t border-border/70">
                {group.items.map((n) => (
                  <li key={n.id}>
                    <NotificationItem
                      id={n.id}
                      kind={n.kind}
                      title={n.title}
                      body={n.body}
                      href={n.href}
                      time={formatRelative(n.createdAt, now)}
                      unread={!n.readAt}
                      staff={staff}
                    />
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
      )}
    </>
  );
}
