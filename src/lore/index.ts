import type { AgentPersona } from "../agent-chat.ts";
import { PERSONA as Astra } from "./astra.ts";
import { PERSONA as Breach } from "./breach.ts";
import { PERSONA as Brimstone } from "./brimstone.ts";
import { PERSONA as Chamber } from "./chamber.ts";
import { PERSONA as Clove } from "./clove.ts";
import { PERSONA as Cypher } from "./cypher.ts";
import { PERSONA as Deadlock } from "./deadlock.ts";
import { PERSONA as Fade } from "./fade.ts";
import { PERSONA as Gekko } from "./gekko.ts";
import { PERSONA as Harbor } from "./harbor.ts";
import { PERSONA as Iso } from "./iso.ts";
import { PERSONA as Jett } from "./jett.ts";
import { PERSONA as Kayo } from "./kayo.ts";
import { PERSONA as Killjoy } from "./killjoy.ts";
import { PERSONA as Neon } from "./neon.ts";
import { PERSONA as Omen } from "./omen.ts";
import { PERSONA as Phoenix } from "./phoenix.ts";
import { PERSONA as Raze } from "./raze.ts";
import { PERSONA as Reyna } from "./reyna.ts";
import { PERSONA as Sage } from "./sage.ts";
import { PERSONA as Skye } from "./skye.ts";
import { PERSONA as Sova } from "./sova.ts";
import { PERSONA as Tejo } from "./tejo.ts";
import { PERSONA as Viper } from "./viper.ts";
import { PERSONA as Vyse } from "./vyse.ts";
import { PERSONA as Yoru } from "./yoru.ts";

export const ALL_PERSONAS: Record<string, AgentPersona> = {
	astra: Astra,
	breach: Breach,
	brimstone: Brimstone,
	chamber: Chamber,
	clove: Clove,
	cypher: Cypher,
	deadlock: Deadlock,
	fade: Fade,
	gekko: Gekko,
	harbor: Harbor,
	iso: Iso,
	jett: Jett,
	kayo: Kayo,
	killjoy: Killjoy,
	neon: Neon,
	omen: Omen,
	phoenix: Phoenix,
	raze: Raze,
	reyna: Reyna,
	sage: Sage,
	skye: Skye,
	sova: Sova,
	tejo: Tejo,
	viper: Viper,
	vyse: Vyse,
	yoru: Yoru,
};
