import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const CNB_BASE = "https://api.cnb.cz/cnbapi";

async function cnbFetch(path: string): Promise<any> {
  const res = await fetch(`${CNB_BASE}${path}`);
  if (!res.ok) throw new Error(`ČNB API error: ${res.status}`);
  return res.json();
}

export function registerTools(server: McpServer) {

  server.tool(
    "get_exchange_rates",
    "Get the official Czech National Bank (ČNB) exchange rate table for a given date. Returns CZK rates for all major currencies (EUR, USD, GBP, CHF, JPY, etc.).",
    {
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to the latest available fixing. ČNB publishes rates on business days."),
    },
    async ({ date }) => {
      const param = date ? `?date=${date}&lang=EN` : "?lang=EN";
      const data = await cnbFetch(`/exrates/daily${param}`);
      const rates: any[] = data.rates ?? [];
      if (rates.length === 0) return { content: [{ type: "text", text: "No exchange rates found for this date. ČNB publishes rates on business days only." }] };

      const validFor = rates[0]?.validFor ?? date ?? "latest";
      let text = `**ČNB Official Exchange Rates — ${validFor}**\n\n`;
      text += `${"Currency".padEnd(8)} ${"Code".padEnd(6)} ${"Country".padEnd(20)} Rate (CZK)\n`;
      text += "─".repeat(55) + "\n";
      for (const r of rates) {
        const amount = r.amount > 1 ? `${r.amount}×` : "  ";
        text += `${amount}${r.currencyCode.padEnd(6)} ${r.currency.padEnd(12)} ${r.country.padEnd(18)} ${r.rate.toFixed(3)}\n`;
      }
      text += `\nSource: Czech National Bank (cnb.cz) — official fixing`;
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "get_currency_rate",
    "Get the official ČNB exchange rate for a specific currency against CZK. Returns current rate and recent history context.",
    {
      currency_code: z.string().length(3).describe("3-letter ISO currency code, e.g. 'EUR', 'USD', 'GBP', 'CHF', 'PLN'"),
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to latest available."),
    },
    async ({ currency_code, date }) => {
      const code = currency_code.toUpperCase();
      const param = date ? `?date=${date}&lang=EN` : "?lang=EN";
      const data = await cnbFetch(`/exrates/daily${param}`);
      const rate = (data.rates ?? []).find((r: any) => r.currencyCode === code);

      if (!rate) return { content: [{ type: "text", text: `Currency ${code} not found in ČNB exchange rate table. ČNB covers major world currencies only.` }] };

      let text = `**ČNB Rate: ${code} → CZK**\n`;
      text += `Date: ${rate.validFor}\n`;
      text += `Rate: **${rate.amount > 1 ? rate.amount + " " : ""}${code} = ${rate.rate.toFixed(3)} CZK**\n`;
      if (rate.amount > 1) text += `(1 ${code} = ${(rate.rate / rate.amount).toFixed(4)} CZK)\n`;
      text += `Country: ${rate.country}\n`;
      text += `\nSource: Czech National Bank official fixing (cnb.cz)`;
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "convert_currency",
    "Convert an amount between any currency and CZK (or between two currencies via CZK) using official ČNB rates.",
    {
      amount: z.number().positive().describe("Amount to convert"),
      from_currency: z.string().length(3).describe("Source currency code, e.g. 'EUR', 'USD', 'CZK'"),
      to_currency: z.string().length(3).describe("Target currency code, e.g. 'CZK', 'EUR', 'USD'"),
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to latest available."),
    },
    async ({ amount, from_currency, to_currency, date }) => {
      const from = from_currency.toUpperCase();
      const to = to_currency.toUpperCase();
      const param = date ? `?date=${date}&lang=EN` : "?lang=EN";
      const data = await cnbFetch(`/exrates/daily${param}`);
      const rates: any[] = data.rates ?? [];

      const getRateToCZK = (code: string): number => {
        if (code === "CZK") return 1;
        const r = rates.find((x: any) => x.currencyCode === code);
        if (!r) throw new Error(`Currency ${code} not in ČNB table`);
        return r.rate / r.amount;
      };

      let fromRate: number, toRate: number;
      try {
        fromRate = getRateToCZK(from);
        toRate = getRateToCZK(to);
      } catch (e: any) {
        return { content: [{ type: "text", text: e.message }] };
      }

      const result = (amount * fromRate) / toRate;
      const validFor = rates[0]?.validFor ?? "latest";
      let text = `**Currency Conversion (ČNB rates, ${validFor})**\n\n`;
      text += `${amount.toLocaleString()} ${from} = **${result.toFixed(4)} ${to}**\n\n`;
      if (from !== "CZK") text += `Rate: 1 ${from} = ${fromRate.toFixed(4)} CZK\n`;
      if (to !== "CZK") text += `Rate: 1 ${to} = ${toRate.toFixed(4)} CZK\n`;
      text += `\nSource: Czech National Bank official fixing (cnb.cz)`;
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "get_pribor",
    "Get PRIBOR (Prague Interbank Offered Rate) — the Czech reference interest rate used in loans and derivatives. Returns rates for all tenors (1D, 1W, 2W, 1M, 2M, 3M, 6M, 9M, 12M).",
    {
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to latest available."),
    },
    async ({ date }) => {
      const param = date ? `?date=${date}&lang=EN` : "?lang=EN";
      const data = await cnbFetch(`/pribor/daily${param}`);
      const pribs: any[] = data.pribs ?? [];
      if (pribs.length === 0) return { content: [{ type: "text", text: "No PRIBOR data found for this date." }] };

      const validFor = pribs[0]?.validFor;
      const periodLabels: Record<string, string> = {
        ONE_DAY: "1D (overnight)",
        ONE_WEEK: "1W",
        TWO_WEEKS: "2W",
        ONE_MONTH: "1M",
        TWO_MONTHS: "2M",
        THREE_MONTHS: "3M",
        SIX_MONTHS: "6M",
        NINE_MONTHS: "9M",
        TWELVE_MONTHS: "12M",
      };

      let text = `**PRIBOR — Prague Interbank Offered Rate (${validFor})**\n\n`;
      for (const p of pribs) {
        const label = periodLabels[p.period] ?? p.period;
        if (p.pribor !== null) text += `${label.padEnd(16)}: ${p.pribor.toFixed(2)}%\n`;
      }
      text += `\nPRIBOR is the benchmark rate for CZK loans and financial contracts.\nSource: Czech National Bank (cnb.cz)`;
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool(
    "get_czeonia",
    "Get CZEONIA (Czech OverNight Index Average) — the reference overnight rate for the CZK money market, set daily by ČNB.",
    {
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to latest available."),
    },
    async ({ date }) => {
      const param = date ? `?date=${date}&lang=EN` : "?lang=EN";
      const data = await cnbFetch(`/czeonia/daily${param}`);

      if (!data || data.rate === undefined) return { content: [{ type: "text", text: "No CZEONIA data found for this date." }] };

      let text = `**CZEONIA — Czech OverNight Index Average**\n\n`;
      text += `Date: ${data.validFor}\n`;
      text += `Rate: **${data.rate.toFixed(2)}%** p.a.\n`;
      if (data.volume) text += `Volume: ${data.volume.toLocaleString()} mil. CZK\n`;
      text += `\nCZEONIA reflects the actual cost of overnight CZK borrowing between banks.\nSource: Czech National Bank (cnb.cz)`;
      return { content: [{ type: "text", text }] };
    }
  );
}
