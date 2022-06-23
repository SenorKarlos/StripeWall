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
const config = require(__dirname + "/files/config.json");

//------------------------------------------------------------------------------
//  SERVER CONFIGURATIONS
//------------------------------------------------------------------------------
var sessionAge = 518400000;
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
//  SUSBCRIBE PAGE
//------------------------------------------------------------------------------
server.get("/subscribe", async function(req, res) {
  let time_now = moment().valueOf();
  let unix_now = moment().unix();
  let user = await database.fetchUser(req.session.discord_id);
  if (!user) {
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.redirect_url}&state=subscribe`);
  }
  let member = bot.guilds.cache.get(config.guild_id).members.cache.get(req.session.discord_id);
  if (bot.blacklisted.indexOf(req.session.discord_id) >= 0) {
    bot.users.fetch(user.user_id).then(blocked => {
      let member = {
        user: blocked
      }
      bot.sendEmbed(member, "FF0000", "Blacklist Login Attempt", "", config.log_channel);
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
//  LOGIN/OAUTH FLOW
//------------------------------------------------------------------------------
server.get("/login", async (req, res) => {
  let time_now = moment().valueOf();
  let unix_now = moment().unix();

  req.session.guild = config.guild_id;

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

    let user_data = [req.session.discord_id, member.user.username, bot.getTime("short"), req.session.email, data.access_token, data.refresh_token, req.session.token_expiration, unix_now]
    database.runQuery(`INSERT IGNORE INTO stripe_users (user_id, user_name, last_login, email, access_token, refresh_token, token_expiration, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, user_data);
    database.runQuery(`UPDATE IGNORE stripe_users SET access_token = ?, refresh_token = ?, token_expiration = ?, last_updated = ? WHERE user_id = ?`, [data.access_token, data.refresh_token, req.session.token_expiration, unix_now, user.id]);

    switch (true) {
      case member == null:
      case member == undefined:
        oauth2.joinGuild(req.session.token, config.guild_id, user.id);
        console.info("[" + bot.getTime("stamp") + "] [wall.js] " + user.username + "#" + user.discriminator + " not a Guild Member, adding.");
        return res.redirect(`/subscribe`);

      case req.query.state == "subscribe":
        return res.redirect(`/subscribe`);

      default:
        return res.redirect(`/subscribe`);
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
    console.info("[" + bot.getTime("stamp") + "] [wall.js] Bad Token Found for " + req.session.user_name + ". Sending User to Discord Oauth2 Authorization URL.");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.redirect_url}&state=${req.query.ip}`);

  } else if (bot.blacklisted.indexOf(req.session.discord_id) >= 0) {
    //------------------------------------------------------------------------------
    //  CHECK BLACKLIST
    //------------------------------------------------------------------------------
    bot.users.fetch(req.session.discord_id).then(user => {
      let member = {
        user: user
      }
      bot.sendEmbed(member, "FF0000", "Blacklist Login Attempt", "", config.log_channel);
      return res.redirect(`/blocked`);
    });

  } else {
    //------------------------------------------------------------------------------
    //  CHECK IF GUILD MEMBER
    //------------------------------------------------------------------------------
    let member = bot.guilds.cache.get(config.guild_id).members.cache.get(req.session.discord_id);
    if (!member) {
      oauth2.joinGuild(req.session.access_token, config.guild_id, req.session.discord_id);
      setTimeout(async function() {
        member = bot.guilds.cache.get(config.guild_id).members.cache.get(req.session.discord_id);
        return res.redirect(`/subscribe`);
      }, 2000);
    }
    return;
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
//  LISTEN ON SPECIFIED PORT
//------------------------------------------------------------------------------
server.listen(config.listening_port, () => {
  console.info("[" + bot.getTime("stamp") + "] [wall.js] Now Listening on port " + config.listening_port + ".");
});