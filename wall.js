const fs = require("fs");
const ini = require("ini");
const ontime = require("ontime");
const moment = require("moment");
const express = require("express");
const discord = require("discord.js");
const bodyParser = require("body-parser");
const cookieSession = require("cookie-session");
const bot = require(__dirname + "/modules/bot.js");
const oauth2 = require(__dirname + "/modules/oauth2.js");
const stripe = require(__dirname + "/modules/stripe.js");
const database = require(__dirname + "/modules/database.js");
const config = ini.parse(fs.readFileSync("./files/config.ini", "utf-8"));

//------------------------------------------------------------------------------
//  TEST MODE CONFIGURATIONS
//------------------------------------------------------------------------------
var sessionAge;

if (config.test_mode == true) {
  sessionAge = 30000;
} else {
  sessionAge = 518400000;
}

//------------------------------------------------------------------------------
//  SERVER CONFIGURATIONS
//------------------------------------------------------------------------------
const server = express();
server.use(bodyParser.urlencoded({
  extended: true
}));

server.engine("html", require("ejs").renderFile);

server.use(cookieSession({
  name: "session",
  keys: [config.session_key],
  maxAge: sessionAge,
}));
//------------------------------------------------------------------------------
//  WEBSITE TRAFFIC FUNNEL
//------------------------------------------------------------------------------
server.get("/login", async (req, res) => {
  let time_now = moment().valueOf();
  let unix_now = moment().unix();

  req.session.guild = config.guild_id;

  // RETURN TO MAP IF NO IP
  if (req.query.ip) {
    req.session.ip = req.query.ip;
  }

  // REDIRECT IF NO IP IS SEEN
/*   if (!req.session.ip || req.session.ip == undefined) {
    return res.redirect(config.map_url);
  }

  // SAVE DETAILS TO SESSION FINGERPRINT OBJECT
  if (!req.session.fp) {
    req.session.fp = {};
  }
  if (req.query.fp) {
    req.session.fp.hash = req.query.fp;
    req.session.fp.device = req.query.device;
    req.session.fp.updated = time_now;
  } */

  // LOG USER DEVICE
/*   if (req.query.device) {
    req.session.device = req.query.device;
  }

  if (req.session.fp.forward) {
    delete req.session.fp.forward;
    return res.redirect(`/subscribe`);
  }

  // OBTAIN FINGERPRINT IF NOT PRESENT OR OUTDATED
  if (!req.session.fp.hash || req.session.fp.updated < (time_now - 3600000)) {
    req.session.fp.updated = time_now;
    return res.redirect(`/fp`);
  } */

  // CHECK USER TOKEN STATUS
  let bad_token = false;
  if (req.session.discord_id) {
    let foundUser = await database.fetchUser(req.session.discord_id);
    switch (true) {
      case !foundUser:
        break;
      case foundUser.access_token == null:
      case foundUser.refresh_token == null:
      case foundUser.token_expiration == null:
      case unix_now > foundUser.token_expiration:
        bad_token = true;
        break;
    }
  }

  //------------------------------------------------------------------------------
  //  REDIRECT FROM OAUTH WITH CODE
  //------------------------------------------------------------------------------
  if (req.query.code) {

    let data = await oauth2.fetchAccessToken(req.query.code);

    let user = await oauth2.fetchUser(data.access_token);

    req.session.discord_id = user.id;
    req.session.email = user.email;
    req.session.access_token = data.access_token;
    req.session.refresh_token = data.refresh_token;
    req.session.token_expiration = (unix_now + data.expires_in);

    if (!user || user == undefined) {
      req.session = null;
      return console.info("[" + bot.getTime("stamp") + "] [wall.js] Failed to fetch User");
    }

    let member = await bot.guilds.cache.get(config.guild_id).members.cache.get(user.id);

    if (!member || member == undefined) {
      await bot.users.fetch(user.id).then(user => {
        member = {
          user: user
        };
      });
    }
    req.session.user_name = member.user.username;

    database.userTrack(req.session);
    database.runQuery(`INSERT IGNORE INTO oauth_queue (user_id, guild_id, last_login, token, inserted) VALUES (?, ?, ?, ?, ?)`, [req.session.discord_id, config.guild_id, bot.getTime("short"), data.access_token, unix_now]);
    let user_data = [req.session.discord_id, member.user.username, bot.getTime("short"), config.map_name, config.guild_id, req.session.email, data.access_token, data.refresh_token, req.session.token_expiration, unix_now]
    database.runQuery(`INSERT IGNORE INTO oauth_users (user_id, user_name, last_login, map_name, map_guild, email, access_token, refresh_token, token_expiration, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, user_data);
    database.runQuery(`UPDATE IGNORE oauth_users SET access_token = ?, refresh_token = ?, token_expiration = ?, last_updated = ? WHERE user_id = ?`, [data.access_token, data.refresh_token, req.session.token_expiration, unix_now, user.id]);

    switch (true) {
      case member == null:
      case member == undefined:
        oauth2.joinGuild(req.session.token, config.guild_id, user.id);
        console.info("[" + bot.getTime("stamp") + "] [wall.js] " + user.username + "#" + user.discriminator + " not a Discord Member (" + req.session.ip + ")");
        // return res.redirect("https://discord.com/channels/@me");
        return res.redirect(`/login`);

      case req.query.state == "subscribe":
        return res.redirect(`/subscribe`);

      default:
        return res.redirect(`/login`);
    }

  } else if (!req.session.discord_id) {
    //------------------------------------------------------------------------------
    //  NO SESSION. SEND TO DISCORD OAUTH2
    //------------------------------------------------------------------------------
    console.info("[" + bot.getTime("stamp") + "] [wall.js] No Session Found from " + req.query.ip + ". Sending User to Discord Oauth2 Authorization URL.");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.redirect_url}&state=${req.query.ip}`);


  } else if (bad_token) {
    //------------------------------------------------------------------------------
    //  TOKEN IS BAD
    //------------------------------------------------------------------------------
    database.userTrack(req.session);
    console.info("[" + bot.getTime("stamp") + "] [wall.js] Bad Token Found for " + req.session.user_name + ". Sending User to Discord Oauth2 Authorization URL.");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.redirect_url}&state=${req.query.ip}`);


  } else if (bot.blacklisted.indexOf(req.session.discord_id) >= 0) {
    //------------------------------------------------------------------------------
    //  CHECK BLACKLIST
    //------------------------------------------------------------------------------
    database.userTrack(req.session);
    let matches = await database.userTrack(req.session);
    bot.users.fetch(req.session.discord_id).then(user => {
      let member = {
        user: user
      }
      if (matches) {
        bot.sendEmbed(member, "FF0000", "Blacklist Login Attempt", "", config.map_log_channel, "Fingerprint Match History:", matches);
      } else {
        bot.sendEmbed(member, "FF0000", "Blacklist Login Attempt", "", config.map_log_channel);
      }
      return res.redirect(`/blocked`);
    });

  } else {
    //------------------------------------------------------------------------------
    //  CHECK IF MEMBER AND/OR DONOR
    //------------------------------------------------------------------------------
    let member = bot.guilds.cache.get(config.guild_id).members.cache.get(req.session.discord_id);
    if (member) {
      let matches = await database.userTrack(req.session);
      let member = bot.guilds.cache.get(config.guild_id).members.cache.get(req.session.discord_id);
      if (member.roles.cache.has(config.donor_role_id) || config.open_map == true) {
        database.runQuery(`INSERT IGNORE INTO oauth_authorization (user_id, expire_timestamp, ip, guild) VALUES (?, ?, ?, ?)`, [req.session.discord_id, unix_now + 5, req.session.ip, config.guild_id]);
        if (!req.session.lastLog || req.session.lastLog < (time_now - 300000)) {
          req.session.lastLog = time_now;
          database.runQuery(`UPDATE IGNORE oauth_users SET last_login = ? WHERE user_id = ? AND map_guild = ?`, [bot.getTime("short"), req.session.discord_id, config.guild_id]);
          console.info("[" + bot.getTime("stamp") + "] [wall.js] " + member.user.tag + " logged into " + config.map_name + " (" + req.session.ip + ")");
        }
/*         if (!req.session.lastLogin || req.session.lastLogin < (time_now - 300000)) {
          req.session.lastLogin = time_now;
          if (matches.partial || matches.full) {
            bot.sendEmbed(member, "FFA500", "Authenticated Login", req.session.ip, config.map_log_channel, "Fingerprint Match History:", matches);
          } else {
            bot.sendEmbed(member, "00FF00", "Authenticated Login", "", config.map_log_channel, "", "");
          }
        } */
        if (config.troll_ids && config.troll_ids.indexOf(member.id) >= 0) {
          let troll_sites = config.troll_sites.split(",");
          let value1 = Math.floor(Math.random() * Math.floor(10 - 1)) + 1;
          let value2 = Math.floor(Math.random() * Math.floor(10 - 1)) + 1;
          let site = Math.floor(Math.random() * Math.floor(troll_sites.length - 1));
          if (value1 == value2) {
            console.info("[" + bot.getTime("stamp") + "] [wall.js] " + member.user.tag + "  Got Trolled. Sent to " + troll_sites[site]);
            return res.redirect(troll_sites[site]);
          } else {
            return res.redirect(config.map_url);
          }
        } else {
          return res.redirect(config.map_url);
        }
      } else {
        req.session.lastLogin = time_now;
        let matches = await database.userTrack(req.session);
        console.info("[" + bot.getTime("stamp") + "] [wall.js] " + member.user.tag + " sent to Subscription Page (" + req.session.ip + ")");
/*         if (matches.partial || matches.full) {
          bot.sendEmbed(member, "FFA500", "Non-Donor Login", req.session.ip, config.map_log_channel, "Fingerprint Match History:", matches);
        } else {
          bot.sendEmbed(member, "FFFF00", "Non-Donor Login", req.session.ip, config.map_log_channel);
        } */
        return res.redirect("/subscribe");
      }
    } else {
      oauth2.joinGuild(req.session.access_token, config.guild_id, req.session.discord_id);
      setTimeout(async function() {
        let matches = await database.userTrack(req.session);
        member = bot.guilds.cache.get(config.guild_id).members.cache.get(req.session.discord_id);
        return res.redirect("https://discord.com/channels/@me");
      }, 2000);
    }
    return;
  }
});
//------------------------------------------------------------------------------
//  SUSBCRIBE PAGE
//------------------------------------------------------------------------------
server.get("/subscribe", async function(req, res) {
  let time_now = moment().valueOf();
  let unix_now = moment().unix();
/*   if (!req.session.fp) {
    req.session.fp = {};
  }
  if (!req.session.fp.hash || req.session.fp.updated < (time_now - 3600000)) {
    req.session.fp.updated = time_now;
    req.session.fp.forward = "subscribe";
    return res.redirect(`/fp`);
  } */
  let user = await database.fetchUser(req.session.discord_id);
  if (!user) {
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.redirect_url}&state=subscribe`);
  }
  let member = bot.guilds.cache.get(config.guild_id).members.cache.get(req.session.discord_id);
  database.userTrack(req.session);
  database.runQuery(`INSERT IGNORE INTO oauth_queue (user_id, last_login, token, inserted, guild_id) VALUES (?, ?, ?, ?, ?)`, [req.session.discord_id, bot.getTime("short"), req.session.access_token, unix_now, config.guild_id]);
  if (bot.blacklisted.indexOf(req.session.discord_id) >= 0) {
    bot.users.fetch(user.user_id).then(blocked => {
      let member = {
        user: blocked
      }
      bot.sendEmbed(member, "FF0000", "Blacklist Login Attempt", "", config.map_log_channel);
      return res.redirect(`/blocked`);
    });
  } else {
    return res.render(__dirname + "/html/subscribe.html", {
      map_name: config.map_name,
      access_type: config.access_type,
      map_url: config.map_url,
      key: config.STRIPE.live_pk,
      email: user.user_name + " - " + user.email,
      id: req.query.id,
      amt: 500,
      guild: config.guild_id
    });
  }
});
//------------------------------------------------------------------------------
//  UNSUSBCRIBE PAGE
//------------------------------------------------------------------------------
server.post("/unsubscribed", async function(req, res) {
  let user = await database.fetchUser(req.session.discord_id);
  let member = bot.guilds.cache.get(config.guild_id).members.cache.get(req.session.discord_id);
  if (user.stripe_id == null) {
    return;
  }
  let customer = await stripe.customer.fetch(user.stripe_id);
  if (customer.deleted == true) {
    return;
  }
  if (customer && customer != "ERROR") {
    stripe.subscription.cancel(member, customer.subscriptions.data[0].id);
    setTimeout(function() {
      return res.redirect(config.map_url);
    }, 5000);
  } else {
    console.info("[wall.js] " + member.user.tag + " attempted to cancel a subscription.");
    setTimeout(function() {
      return res.redirect(config.map_url);
    }, 5000);
  }
});
//------------------------------------------------------------------------------
//  PAYMENT CAPTURE SUCCESS
//------------------------------------------------------------------------------
server.post("/success", async function(req, res) {
  let customer = "",
    subscription = "";
  let user = await database.fetchUser(req.session.discord_id);
  let member = bot.guilds.cache.get(config.guild_id).members.cache.get(req.session.discord_id);
  if (user.stripe_id) {
    customer = await stripe.customer.fetch(user.stripe_id);
  }
  if (!customer || customer.deleted == true) {
    customer = await stripe.customer.create(user.user_name, user.user_id, user.email, req.body.stripeToken);
    if (customer == "ERROR") {
      bot.sendDM(member, "Payment Failed", "Your Subscription payment unfortunately failed. Please check your card account or try a different card.", "FF0000");
      return res.redirect("/subscribe");
    }
  }
  if (!customer.subscriptions.data[0]) {
    subscription = await stripe.subscription.create(customer, user.user_id);
  } else {
    subscription = await stripe.customer.update(user.user_id, customer, req.body.stripeToken);
  }
  if (subscription == "ERROR") {
    bot.sendDM(member, "Payment Failed", "Your Subscription payment unfortunately failed. Please check your card account or try a different card.", "FF0000");
    return res.redirect("/subscribe");
  } else if (subscription == "INCOMPLETE") {
    bot.sendDM(member, "Payment Failed", "Your Subscription payment unfortunately failed, but a customer record was created. Use the Update button after checking your card account or try a different card.", "FF0000");
    return res.redirect("/subscribe");
  } else {
    setTimeout(function() {
      return res.redirect(config.map_url);
    }, 5000);
  }
});
//------------------------------------------------------------------------------
//  SRIPE WEBHOOKS
//------------------------------------------------------------------------------
server.post("/webhook", bodyParser.raw({
  type: "application/json"
}), (webhook, res) => {
  res.sendStatus(200);
  return stripe.webhookParse(JSON.parse(webhook.body));
});
//------------------------------------------------------------------------------
//  BLOCKED PAGE
//------------------------------------------------------------------------------
server.get("/blocked", async function(req, res) {
  return res.render(__dirname + "/html/blocked.html");
});
//------------------------------------------------------------------------------
//  DEVICE PAGE
//------------------------------------------------------------------------------
server.get("/device", async function(req, res) {
  return res.render(__dirname + "/html/device.html");
});
//------------------------------------------------------------------------------
//  ERROR PAGE
//------------------------------------------------------------------------------
server.get("/error", async function(req, res) {
  return res.render(__dirname + "/html/error.html");
});
//------------------------------------------------------------------------------
//  FINGERPRINT PAGE
//------------------------------------------------------------------------------
/* server.get("/fp", async function(req, res) {
  return res.render(__dirname + "/html/fingerprint.html");
}); */
//------------------------------------------------------------------------------
//  SYNC USER GUILDS
//------------------------------------------------------------------------------
/* ontime({
  cycle: ["03:00:00"]
}, function(ot) {
  console.info("[" + bot.getTime("stamp") + "] [wall.js] Starting User Guild Check.");
  database.guildsCheck();
  ot.done();
  console.info("[" + bot.getTime("stamp") + "] [wall.js] User Guild Check Complete.");
  return;
}); */
//------------------------------------------------------------------------------
//  SYNC DISCORD ROLES AND STRIPE SUSBCRIBERS
//------------------------------------------------------------------------------
if (config.test_mode != true) {
  let times = ["05:30:00", "11:30:00", "17:30:00", "00:30:00"];
  ontime({
    cycle: times
  }, function(ot) {
    console.info("[" + bot.getTime("stamp") + "] [wall.js] Starting Stripe Database Maintenance.");
    database.checkDonors();
    ot.done();
    console.info("[" + bot.getTime("stamp") + "] [wall.js] Stripe Database Maintenance Complete.");
    return;
  });
}
//------------------------------------------------------------------------------
//  SYNC STRIPE CUSTOMER IDs
//------------------------------------------------------------------------------
ontime({
  cycle: ["05:05:00", "11:05:00", "17:05:00", "00:20:00"]
}, function(ot) {
  console.info("[" + bot.getTime("stamp") + "] [wall.js] Starting Stripe Customer Synchronization.");
  stripe.customer.list();
  ot.done();
  console.info("[" + bot.getTime("stamp") + "] [wall.js] Stripe Customer Synchronization Complete.");
  return;
});
//------------------------------------------------------------------------------
//  KEEP AUTHORIZATION TABLE TIDY
//------------------------------------------------------------------------------
setInterval(function() {
  let time_now = moment().unix();
  database.runQuery(`DELETE FROM oauth_authorization WHERE expire_timestamp < UNIX_TIMESTAMP()-10 AND guild = ?`, [config.guild_id]);
}, 15000);
//------------------------------------------------------------------------------
//  LISTEN ON SPECIFIED PORT
//------------------------------------------------------------------------------
server.listen(config.listening_port, () => {
  console.info("[" + bot.getTime("stamp") + "] [wall.js] Now Listening on port " + config.listening_port + ".");
});

// CREATE TABLE oauth_users (
//   user_id varchar(255) NOT NULL,
//   user_name varchar(255) NOT NULL,
//   last_login varchar(255) NULL,
//   map_name varchar(255) NOT NULL,
//   map_guild varchar(255) NOT NULL,
//   stripe_id varchar(255) NULL,
//   plan_id varchar(255) NULL,
//   guilds mediumtext NULL,
//   email varchar(255) NULL,
//   token varchar(255) NULL,
//   last_updated BIGINT,
//   CONSTRAINT PK_User PRIMARY KEY (user_id,map_guild)
// );
//
// CREATE TABLE oauth_authorization (
//   user_id varchar(255) NOT NULL,
//   expire_timestamp varchar(255) NOT NULL,
//   ip varchar(255) NULL,
//   guild varchar(255) NOT NULL,
//   CONSTRAINT PK_User PRIMARY KEY (user_id,guild)
// );
//
// CREATE TABLE oauth_fingerprints (
//   user_id varchar(255) NOT NULL,
//   user_name varchar(255) NOT NULL,
//   ip_address varchar(255) NOT NULL,
//   fingerprint varchar(255) NOT NULL,
//   map_name varchar(255) NOT NULL,
//   map_guild varchar(255) NOT NULL,
//   CONSTRAINT PK_User PRIMARY KEY (user_id,ip_address,fingerprint)
// );
//
// CREATE TABLE oauth_queue (
//   user_id varchar(255) NOT NULL,
//   last_login varchar(255) NOT NULL,
//   token varchar(255) NOT NULL,
//   inserted varchar(255) NOT NULL,
//   guild_id varchar(255) NOT NULL,
//   PRIMARY KEY(user_id)
// );