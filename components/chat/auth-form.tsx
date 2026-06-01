import Form from "next/form";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function AuthForm({
  action,
  children,
  defaultEmail = "",
  emailReadOnly = false,
  hiddenFields = [],
  hideEmail = false,
}: {
  action: NonNullable<
    string | ((formData: FormData) => void | Promise<void>) | undefined
  >;
  children: React.ReactNode;
  defaultEmail?: string;
  emailReadOnly?: boolean;
  hideEmail?: boolean;
  hiddenFields?: Array<{ name: string; value: string }>;
}) {
  return (
    <Form action={action} className="flex flex-col gap-4">
      {hiddenFields.map((field) => (
        <input
          key={field.name}
          name={field.name}
          type="hidden"
          value={field.value}
        />
      ))}

      {!hideEmail && (
        <div className="flex flex-col gap-2">
          <Label className="font-normal text-muted-foreground" htmlFor="email">
            Email
          </Label>
          <Input
            autoComplete="email"
            autoFocus
            className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
            defaultValue={defaultEmail}
            id="email"
            name="email"
            placeholder="you@someo.ne"
            readOnly={emailReadOnly}
            required
            type="email"
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label className="font-normal text-muted-foreground" htmlFor="password">
          Password
        </Label>
        <Input
          autoComplete="new-password"
          className="h-10 rounded-lg border-border/50 bg-muted/50 text-sm transition-colors focus:border-foreground/20 focus:bg-muted"
          id="password"
          minLength={8}
          name="password"
          placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
          required
          type="password"
        />
      </div>

      {children}
    </Form>
  );
}
