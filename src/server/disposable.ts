import "server-only";

// Common disposable and throwaway email domains, bundled so no network fetch is needed. Not exhaustive:
// it stops the well-known ones. A subdomain of a listed domain counts (x@a.mailinator.com).
const DOMAINS = `
0-mail.com 0clickemail.com 10mail.org 10minutemail.co.uk 10minutemail.com 10minutemail.de 10minutemail.net 10minutemail.org 10minutesmail.com 12minutemail.com 1secmail.com 1secmail.net
1secmail.org 20email.eu 20mail.eu 20mail.it 20minutemail.com 2prong.com 30minutemail.com 33mail.com 4warding.com 4warding.net 4warding.org 60minutemail.com 6ip.us 6url.com 7tags.com
agedmail.com ajaxapp.net amilegit.com anonbox.net anonmails.de anonymbox.com antispam.de antispam24.de armyspy.com bigstring.com binkmail.com bobmail.info bofthew.com bootybay.de boxtemp.com.br
brefmail.com broadbandninja.com bsnow.net bspamfree.org bugmenot.com bumpymail.com burnermail.io byom.de casualdx.com cheatmail.de chogmail.com choicemail1.com clixser.com cool.fr.nf
courrieltemporaire.com crapmail.org crazymailing.com cubiclink.com cuvox.de dacoolest.com dandikmail.com dayrep.com dcemail.com deadaddress.com deadfake.cf deadfake.ga deadfake.ml deadfake.tk
deadspam.com despam.it despammed.com devnullmail.com discard.cf discard.email discard.ga discard.gq discard.ml discard.tk discardmail.com discardmail.de dispomail.eu disposable-email.ml
disposable.cf disposable.ga disposable.ml disposableaddress.com disposableemailaddresses.com disposableinbox.com dispose.it disposeamail.com disposemail.com dispostable.com dodgeit.com
dodgit.com dodgit.org dontreg.com dontsendmespam.de drdrb.com dropmail.me dudmail.com dump-email.info dumpandjunk.com dumpmail.de dumpyemail.com e4ward.com easytrashmail.com einrot.com
einrot.de eintagsmail.de email-fake.com email60.com emailage.cf emailage.ga emailage.gq emailage.ml emailage.tk emaildienst.de emailfake.com emailias.com emailigo.de emailinfive.com
emailisvalid.com emaillime.com emailmiser.com emailna.co emailnator.com emailondeck.com emailsensei.com emailtemporanea.com emailtemporanea.net emailtemporar.ro emailtemporario.com.br
emailthe.net emailtmp.com emailto.de emailwarden.com emailx.at.hm emailxfer.com emeil.in emeil.ir emkei.cf emkei.ga emkei.gq emkei.ml emkei.tk enterto.com ephemail.net explodemail.com
express.net.ua eyepaste.com fadingemail.com fakeinbox.cf fakeinbox.com fakeinbox.ga fakeinbox.ml fakeinbox.tk fakeinformation.com fakemail.fr fakemail.net fakemailgenerator.com fakemailz.com
fakermail.com fammix.com fastacura.com fastchevy.com fastchrysler.com fastkawasaki.com fastmazda.com fastnissan.com fastsubaru.com fasttoyota.com fightallspam.com filzmail.com fivemail.de
fixmail.tk fizmail.com flyspam.com footard.com forgetmail.com fr33mail.info frapmail.com friendlymail.co.uk fuckingduh.com garbagemail.org get-mail.cf get-mail.ga get-mail.ml get-mail.tk
get1mail.com get2mail.fr getairmail.cf getairmail.com getairmail.ga getairmail.gq getairmail.ml getairmail.tk getnada.com getonemail.com getonemail.net ghosttexter.de giantmail.de
gishpuppy.com glitch.sx goemailgo.com gowikibooks.com gowikicampus.com gowikifilms.com gowikigames.com gowikimusic.com gowikinetwork.com gowikitravel.com gowikitv.com grandmamail.com
grandmasmail.com great-host.in greensloth.com grr.la guerillamail.biz guerillamail.com guerillamail.de guerillamail.info guerillamail.net guerillamail.org guerillamailblock.com
guerrillamail.biz guerrillamail.com guerrillamail.de guerrillamail.info guerrillamail.net guerrillamail.org guerrillamailblock.com gustr.com h8s.org haltospam.com harakirimail.com
hatespam.org herp.in hidemail.de hidzz.com hochsitze.com hot-mail.cf hot-mail.ga hot-mail.gq hot-mail.ml hot-mail.tk hulapla.de ieatspam.eu ieatspam.info ieh-mail.de ihateyoualot.info
iheartspam.org imails.info inbax.tk inboxalias.com inboxbear.com inboxclean.com inboxclean.org inboxkitten.com inboxproxy.com incognitomail.com incognitomail.net incognitomail.org
instant-mail.de instantemailaddress.com ipoo.org irish2me.com iwi.net jetable.com jetable.fr.nf jetable.net jetable.org jnxjn.com jourrapide.com junk1e.com junkmail.ga junkmail.gq
kasmail.com kaspop.com keepmymail.com killmail.com killmail.net kimsdisk.com klassmaster.com klassmaster.net klzlk.com koszmail.pl kurzepost.de lackmail.net lags.us landmail.co lastmail.co
lazyinbox.com letthemeatspam.com lhsdv.com lifebyfood.com link2mail.net litedrop.com lookugly.com lortemail.dk lovemeleaveme.com lroid.com lukop.dk m21.cc mail-filter.com mail-temporaire.com
mail-temporaire.fr mail.mezimages.net mail1a.de mail21.cc mail2rss.org mail333.com mail4trash.com mailbidon.com mailbiz.biz mailblocks.com mailbucket.org mailcat.biz mailcatch.com mailcheap.co
mailde.de mailde.info maildrop.cc maildrop.cf maildrop.ga maildrop.gq maildrop.ml maildu.de maildx.com maileater.com mailed.ro maileimer.de mailexpire.com mailfa.tk mailfall.com
mailfreeonline.com mailfs.com mailguard.me mailhazard.com mailhazard.us mailhz.me mailimate.com mailin8r.com mailinater.com mailinator.com mailinator.net mailinator.org mailinator2.com
mailincubator.com mailismagic.com mailjunk.cf mailjunk.ga mailjunk.gq mailjunk.ml mailjunk.tk mailmate.com mailme.gq mailme.ir mailme.lv mailme24.com mailmetrash.com mailmoat.com mailms.com
mailnator.com mailnesia.com mailnull.com mailorg.org mailpick.biz mailproxsy.com mailquack.com mailrock.biz mailsac.com mailscrap.com mailseal.de mailshell.com mailsiphon.com mailslapping.com
mailslite.com mailtemp.info mailtemporaire.com mailtemporaire.fr mailtome.de mailtothis.com mailtrash.net mailtv.net mailtv.tv mailzilla.com mailzilla.org makemetheking.com manybrain.com
mbx.cc meinspamschutz.de meltmail.com messagebeamer.de mezimages.net mierdamail.com migmail.pl migumail.com mintemail.com minuteinbox.com mjukglass.nu moakt.cc moakt.co moakt.com moakt.ws
mohmal.com moncourrier.fr.nf monemail.fr.nf monmail.fr.nf monumentmail.com mt2009.com mt2014.com mt2015.com mxfuel.com my10minutemail.com mycleaninbox.net mymail-in.net myphantomemail.com
mysamp.de myspamless.com mytemp.email mytempemail.com mytempmail.com mytrashmail.com nabuma.com nepwk.com nervmich.net nervtmich.net netmails.com netmails.net netzidiot.de neverbox.com
nice-4u.com nincsmail.com nincsmail.hu nmail.cf no-spam.ws nobulk.com noclickemail.com nogmailspam.info nomail.pw nomail.xl.cx nomail2me.com nomorespamemails.com nonspam.eu nonspammer.de
noref.in nospam.ze.tc nospam4.us nospamfor.us nospammail.net nospamthanks.info notmailinator.com notsharingmy.info nowhere.org nowmymail.com nurfuerspam.de objectmail.com obobbo.com
odaymail.com odnorazovoe.ru one-time.email oneoffemail.com oneoffmail.com onewaymail.com onlatedotcom.info online.ms opayq.com otherinbox.com ourklips.com outlawspam.com ovpn.to owlpic.com
pancakemail.com paplease.com pepbot.com pimpedupmyspace.com pjjkp.com plexolan.de pokemail.net politikerclub.de poofy.org pookmail.com privatdemail.net proxymail.eu prtnx.com punkass.com
putthisinyourspamdatabase.com pwrby.com qisdo.com qisoa.com quickinbox.com quickmail.nl rcpt.at reallymymail.com recode.me recursor.net recyclemail.dk regbypass.com rejectmail.com
reliable-mail.com remail.cf remail.ga rhyta.com rklips.com rmqkr.net royal.net rppkn.com rtrtr.com s0ny.net safe-mail.net safersignup.de safetymail.info safetypost.de sandelf.de saynotospams.com
scatmail.com schafmail.de schrott-email.de secretemail.de secure-mail.biz selfdestructingmail.com selfdestructingmail.org sendspamhere.com sharedmailbox.org sharklasers.com shieldedmail.com
shitmail.me shitmail.org shitware.nl shmeriously.com shortmail.net showslow.de sinnlos-mail.de siteposter.net skeefmail.com slapsfromlastnight.com slaskpost.se slopsbox.com smashmail.de
smellfear.com snakemail.com sneakemail.com sneakmail.de snkmail.com sofort-mail.de sogetthis.com solvemail.info soodonims.com spam.la spam.su spam4.me spamail.de spamarrest.com spamavert.com
spambob.com spambob.net spambob.org spambog.com spambog.de spambog.net spambog.ru spambooger.com spambox.info spambox.us spambox.xyz spamcannon.com spamcannon.net spamcero.com spamcon.org
spamcorptastic.com spamcowboy.com spamcowboy.net spamcowboy.org spamday.com spamex.com spamfighter.cf spamfighter.ga spamfighter.gq spamfighter.ml spamfighter.tk spamfree.eu spamfree24.com
spamfree24.de spamfree24.eu spamfree24.info spamfree24.net spamfree24.org spamgoes.in spamgourmet.com spamgourmet.net spamgourmet.org spamherelots.com spamhereplease.com spamhole.com
spamify.com spaminator.de spamkill.info spaml.com spaml.de spammotel.com spamobox.com spamoff.de spamsalad.in spamslicer.com spamspot.com spamstack.net spamthis.co.uk spamthisplease.com
spamtrail.com spamtroll.net speed.1s.fr spoofmail.de squizzy.de ssoia.com startkeys.com stinkefinger.net stop-my-spam.cf stop-my-spam.com stop-my-spam.ga stop-my-spam.ml stop-my-spam.tk
streetwisemail.com stuffmail.de super-auswahl.de supergreatmail.com supermailer.jp superrito.com superstachel.de suremail.info svk.jp sweetxxx.de tafmail.com tagyourself.com talkinator.com
tapchicuoihoi.com teewars.org teleworm.com teleworm.us temp-mail.com temp-mail.de temp-mail.io temp-mail.live temp-mail.org temp-mail.ru tempail.com tempalias.com tempe-mail.com tempemail.biz
tempemail.co.za tempemail.com tempemail.net tempinbox.co.uk tempinbox.com tempmail.co tempmail.de tempmail.eu tempmail.it tempmail.net tempmail.us tempmail2.com tempmaildemo.com
tempmailaddress.com tempmailer.com tempmailer.de tempmailin.com tempmailo.com tempomail.fr temporarily.de temporarioemail.com.br temporaryemail.net temporaryemail.us temporaryforwarding.com
temporaryinbox.com temporarymailaddress.com tempr.email tempsky.com tempthe.net tempymail.com thanksnospam.info thankyou2010.com thc.st thecloudindex.com thelimestones.com
thisisnotmyrealemail.com thismail.net throam.com throwaway.email throwawayemailaddress.com throwawaymail.com tilien.com tittbit.in tizi.com tmail.io tmail.ws tmailinator.com tmpmail.net
tmpmail.org toiea.com toomail.biz topranklist.de tradermail.info trash-amil.com trash-mail.at trash-mail.cf trash-mail.com trash-mail.de trash-mail.ga trash-mail.gq trash-mail.ml trash-mail.tk
trash2009.com trash2010.com trash2011.com trashdevil.com trashdevil.de trashemail.de trashmail.at trashmail.com trashmail.de trashmail.io trashmail.me trashmail.net trashmail.org
trashmail.ws trashmailer.com trashymail.com trashymail.net trbvm.com trillianpro.com tryalert.com turual.com twinmail.de twoweirdtricks.com tyldd.com uggsrock.com umail.net upliftnow.com
uplipht.com uroid.com venompen.com veryrealemail.com viditag.com viewcastmedia.com vipmail.name vomoto.com vpn.st vsimcard.com vubby.com walala.org walkmail.net wasteland.rfc822.org
webemail.me webm4il.info webuser.in wegwerfadresse.de wegwerfemail.com wegwerfemail.de wegwerfmail.de wegwerfmail.info wegwerfmail.net wegwerfmail.org wetrainbayarea.com wh4f.org
whatiaas.com whatpaas.com whatsaas.com whopy.com whyspam.me wickmail.net wilemail.com willhackforfood.biz willselfdestruct.com winemaven.info wronghead.com wuzup.net wuzupmail.net
wwwnew.eu xagloo.com xemaps.com xents.com xmaily.com xoxy.net xyzfree.net yanet.me yapped.net yep.it yogamaven.com yopmail.com yopmail.fr yopmail.gq yopmail.net yuurok.com zehnminuten.de
zehnminutenmail.de zetmail.com zippymail.info zoaxe.com zoemail.com zoemail.net zoemail.org zomg.info
`
  .split(/\s+/)
  .filter(Boolean);

const SET = new Set(DOMAINS);

/** True when the address's domain, or a parent of it, is on the list. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (SET.has(parts.slice(i).join("."))) return true;
  return false;
}
