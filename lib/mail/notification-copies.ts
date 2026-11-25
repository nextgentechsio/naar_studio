import { usersCollection } from "@/lib/db/mongodb";
import { sendMailLater } from "./graph";
import { appUrl, notificationEmail } from "./templates";

// --------------------------------------------------
// A copy of each notification by email, to every
// recipient (everyone, for "everyone") who has an email
// address and isn't disabled. Not to its sender.
// --------------------------------------------------

export function emailNotificationCopies(input: {
  title: string;
  body: string;
  level: "info" | "important";
  recipients: string[] | null;
  senderId: string;
}): void {
  sendMailLater(async () => {
    const users = await (await usersCollection())
      .find(
        {
          ...(input.recipients ? { _id: { $in: input.recipients } } : {}),
          disabled: { $ne: true },
          email: { $type: "string", $ne: "" },
        },
        { projection: { _id: 1, email: 1 } }
      )
      .toArray();
    const url = appUrl();
    const content = notificationEmail({
      title: input.title,
      body: input.body,
      level: input.level,
      // From the project budget checks
      budget: input.senderId === "system:budgets",
      url,
    });
    const addresses = new Set(
      users.filter((user) => user._id !== input.senderId).map((user) => String(user.email).toLowerCase())
    );
    return [...addresses].map((to) => ({ to, ...content }));
  }, "notification");
}
