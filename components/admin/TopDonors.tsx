/**
 * TopDonors — table of the top N donors by INR-equivalent total.
 * Server-rendered; pagination is not needed at the spec'd `limit = 10`.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TopDonor } from "@/lib/analytics";

interface Props {
  donors: TopDonor[];
}

const INR_FORMAT = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function TopDonors({ donors }: Props) {
  if (donors.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top donors</CardTitle>
          <CardDescription>Ranked by total INR-equivalent tipped.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-ink-muted">No donors yet.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top donors</CardTitle>
        <CardDescription>Ranked by total INR-equivalent tipped.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-elevated/50 text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-2">Donor</th>
              <th className="px-4 py-2 text-right">Tips</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {donors.map((d, i) => {
              const initial = d.displayName.trim().charAt(0).toUpperCase() || "•";
              return (
                <tr key={`${d.displayName}-${i}`} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      {d.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={d.avatarUrl} alt="" width={24} height={24} className="size-6 rounded-full object-cover" />
                      ) : (
                        <div
                          className="flex size-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                          style={{ background: "linear-gradient(135deg, hsl(200 70% 35%), hsl(260 70% 25%))" }}
                          aria-hidden
                        >
                          {initial}
                        </div>
                      )}
                      <span className="truncate font-medium" title={d.displayName}>
                        {d.displayName}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{d.tipCount}</td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {INR_FORMAT.format(d.totalInrPaise / 100)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}