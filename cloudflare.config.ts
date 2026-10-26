import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

export default defineConfig({
	worker: {
		name: "boox-standby-ws",
		compatibilityDate: "2026-10-19",
		entrypoint,
		triggers: [triggers.scheduled({ schedule: "0 */4 * * *" })],
		env: {
			STANDBY: bindings.kv({
				id: "a2d48b3f906d4ef6ae91b6d53fa4c684",
			}),
			ZAI_API_KEY: bindings.secret(),
			HAE_READ_KEY: bindings.secret(),
			CRON_TOKEN: bindings.secret(),
			CITY: bindings.text("杭州"),
			LAT: bindings.text("30.2936"),
			LON: bindings.text("120.1614"),
			GITHUB_USER: bindings.text("hongyangchun"),
			EXPIRE_DATE: bindings.text("2027-01-27"),
		},
	},
});
