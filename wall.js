const ontime = require("ontime");
const moment = require("moment");
const express = require("express");
const discord = require("discord.js");
const bodyParser = require("body-parser");
const cookieSession = require("cookie-session");
const bot = require(__dirname+"/modules/bot.js");
const oauth2 = require(__dirname+"/modules/oauth2.js");
const stripe = require(__dirname+"/modules/stripe.js");
const database = require(__dirname+"/modules/database.js");
const config = require(__dirname+"/files/config.json");

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
//  LOGIN/OAUTH FLOW
//------------------------------------------------------------------------------
server.get("/login", async (req, res) => {
  let time_now = moment().valueOf();
  let unix_now = moment().unix();
  if (!req.query.code) {
  //------------------------------------------------------------------------------
  //  SEND TO DISCORD OAUTH2
  //------------------------------------------------------------------------------
    console.info("["+bot.getTime("stamp")+"] [wall.js] Login from "+req.headers['x-forwarded-for']+". Sending User to Discord Oauth2 Authorization URL.");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
  //------------------------------------------------------------------------------
  //  REDIRECT FROM OAUTH WITH CODE
  //------------------------------------------------------------------------------
    let data = await oauth2.fetchAccessToken(req.query.code);
    let user = await oauth2.fetchUser(data.access_token);
    if (!user || user == undefined) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to fetch User");
      return res.redirect(config.map_url);
    }
    //------------------------------------------------------------------------------
    //  CHECK BLACKLIST & GUILD MEMBER STATUS
    //------------------------------------------------------------------------------
    if (bot.blacklisted.indexOf(req.session.discord_id) >= 0) {
      let member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.id);
      if (!member || member == undefined) {
        await bot.users.fetch(user.id).then(user => {
          member = {
            user: user
          };
        });
      }
      bot.sendEmbed(member, "FF0000", "Blacklist Login Attempt", "", config.discord.log_channel);
      return res.redirect(`/blocked`);
    }
    let member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.id);
    if (!member) {
      await oauth2.joinGuild(data.access_token, config.discord.guild_id, user.id);
      await bot.users.fetch(user.id).then(user => {
        member = {
          user: user
        };
      });
      console.info("["+bot.getTime("stamp")+"] [wall.js] "+member.user.username+"#"+member.user.discriminator+" not a Guild Member, adding.");
    }
    req.session.discord_id = user.id;
    req.session.email = user.email;
    req.session.access_token = data.access_token;
    req.session.refresh_token = data.refresh_token;
    req.session.token_expiration = (unix_now+data.expires_in);
    req.session.user_name = member.user.username;

    let user_data = [req.session.discord_id, member.user.username, bot.getTime("short"), req.session.email, data.access_token, data.refresh_token, req.session.token_expiration, unix_now]
    database.runQuery(`INSERT IGNORE INTO stripe_users (user_id, user_name, last_login, email, access_token, refresh_token, token_expiration, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, user_data);
    database.runQuery(`UPDATE IGNORE stripe_users SET access_token = ?, refresh_token = ?, token_expiration = ?, last_updated = ? WHERE user_id = ?`, [data.access_token, data.refresh_token, req.session.token_expiration, unix_now, user.id]);

    let dbuser = await database.fetchUser(req.session.discord_id);
    let dbChecked = false;
    if (req.session.email != dbuser.email || req.session.user_name != dbuser.user_name) {
      database.runQuery(`UPDATE IGNORE stripe_users SET email = ?, user_name = ? WHERE user_id = ?`, [req.session.email, req.session.user_name, dbuser.user_id]);
      console.info("["+bot.getTime("stamp")+"] [wall.js] Updated DB Info for User "+req.session.user_name+ ","+req.session.email+" Formerly: "+dbuser.user_name+","+dbuser.email);
      dbChecked = true;
    } else {
      dbChecked = true;
    }
    let stripeChecked = false;
    if (!dbuser.stripe_id) {
      let customer = await stripe.customer.create(req.session.user_name, req.session.discord_id, req.session.email);
      dbuser.stripe_id = customer.id;
      stripeChecked = true;
    }
    let customer = await stripe.customer.fetch(dbuser.stripe_id);
    if (stripeChecked == false && customer && customer != 'ERROR') {
      console.info("["+bot.getTime("stamp")+"] [wall.js] Found Stripe Info for User "+req.session.user_name);
      if (req.session.discord_id != customer.description) {
        bot.sendDM(member, "Error Logging In", "Please contact administration for further assistance", "FF0000");
        bot.sendEmbed(member, "FF0000", "User ID Discrepancy Found", "User "+dbuser.user_name+"'s Discord ID ("+req.session.discord_id+") not found on matched Stripe Record ("+customer.id+","+customer.description+")", config.discord.log_channel);
        return res.redirect(config.map_url);
      }
      if (req.session.email != customer.email || req.session.user_name != customer.name) {
        await stripe.customer.update(dbuser.stripe_id, req.session.email, req.session.user_name);
      }
      if (customer.subscriptions.total_count > 0) {
        if (customer.subscriptions.data[0].items.data[0].price.id && !dbuser.price_id || dbuser.price_id && customer.subscriptions.data[0].items.data[0].price.id && dbuser.price_id != customer.subscriptions.data[0].items.data[0].price.id) {
          database.runQuery(`UPDATE IGNORE stripe_users SET price_id = ? WHERE user_id = ?`, [customer.subscriptions.data[0].items.data[0].price.id, dbuser.user_id]);
          console.info("["+bot.getTime("stamp")+"] [wall.js] Updated DB Info for User "+req.session.user_name+ ","+req.session.email+"(Invalid/Missing Plan Updated)");
          dbuser.price_id = customer.subscriptions.data[0].items.data[0].price.id;
        }
      }
      if (dbuser.price_id) {
        if (customer.subscriptions.total_count == 0 && dbuser.temp_plan_expiration == null) {
          database.runQuery(`UPDATE IGNORE stripe_users SET price_id = NULL WHERE user_id = ?`, [dbuser.user_id]);
          console.info("["+bot.getTime("stamp")+"] [wall.js] Updated DB Info for User "+req.session.user_name+ ","+req.session.email+"(Invalid Plan Deleted)");
          dbuser.price_id = null;
        }
      }
      stripeChecked = true;
    }
    if (dbChecked == false || stripeChecked == false) {
      bot.sendDM(member, "Error Logging In", "Please contact administration for further assistance", "FF0000");
      bot.sendEmbed(member, "FF0000", "Login Flow Error", "User "+req.session.user_name+" DB Pass = "+dbChecked+", Stripe Pass = "+stripeChecked, config.discord.log_channel);
      return res.redirect(config.map_url);
    } else {
      req.session.login = true;
      req.session.stripe_id = dbuser.stripe_id;
      if (dbuser.price_id && dbuser.temp_plan_expiration == null) {
        return res.redirect(`/manage`);
      } else if(dbuser.price_id && dbuser.temp_plan_expiration != null && dbuser.temp_plan_expiration > unix_now) {
        req.session.expiry = dbuser.temp_plan_expiration;
        return res.redirect(`/expiry`);
      } else {
      return res.redirect(`/checkout`);
      }
    }
  }
});
//------------------------------------------------------------------------------
//  PRODUCTS CHECKOUT PAGE
//------------------------------------------------------------------------------
server.get("/checkout", async function(req, res) {
  if (!req.session.login) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
    let checkoutbody = '';
    for (let i = 0; i < config.stripe.price_ids.length; i++) {
      let pricehtml = '<div><h2>'+config.stripe.price_ids[i].title+'</h2><p><strong>'+config.stripe.price_ids[i].text+'</strong></p><form action="/create-checkout-session" method="post"><input type="hidden" name="priceID" value="'+config.stripe.price_ids[i].id+'" /><input type="hidden" name="mode" value="'+config.stripe.price_ids[i].mode+'" /><input type="hidden" name="customerID" value="'+req.session.stripe_id+'" /><button type="submit">Continue</button></form></div><br><hr>';
      checkoutbody = checkoutbody+pricehtml;
    }
    return res.render(__dirname+"/html/checkout.html", {
      welcome: config.pages.checkout.welcome,
      terms: config.pages.general.terms,
      warning: config.pages.general.warning,
      checkoutbody: checkoutbody,
      map_name: config.map_name,
      map_url: config.map_url,
      user_name: req.session.user_name,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  STRIPE CHECKOUT
//------------------------------------------------------------------------------
server.post("/create-checkout-session", async (req, res) => {
  return stripe.sessions.checkout(req, res);
});
//------------------------------------------------------------------------------
//  CUSTOMER PORTAL PAGE
//------------------------------------------------------------------------------
server.get("/manage", async function(req, res) {
  if (!req.session.login) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
    return res.render(__dirname+"/html/manage.html", {
      terms: config.pages.general.terms,
      warning: config.pages.general.warning,
      customerID: req.session.stripe_id,
      map_name: config.map_name,
      map_url: config.map_url,
      user_name: req.session.user_name,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  STRIPE CUSTOMER PORTAL
//------------------------------------------------------------------------------
server.post("/create-customer-portal-session", async (req, res) => {
  return stripe.sessions.portal(req, res);
});
//------------------------------------------------------------------------------
//  ACTIVE ONE-TIME CUSTOMER PAGE
//------------------------------------------------------------------------------
server.get("/expiry", async function(req, res) {
  if (!req.session.login) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
    let expiry = new Date(req.session.expiry * 1000).toLocaleString('en-US', { timeZone: config.pages.expiry.time_zone });
    return res.render(__dirname+"/html/expiry.html", {
      terms: config.pages.general.terms,
      warning: config.pages.general.warning,
      customerID: req.session.stripe_id,
      expiry: expiry,
      tz_text: config.pages.expiry.tz_text,
      map_name: config.map_name,
      map_url: config.map_url,
      user_name: req.session.user_name,
      email: req.session.email
    });
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
  return res.render(__dirname+"/html/blocked.html");
}); /*
//------------------------------------------------------------------------------
//  SYNC DISCORD ROLES AND STRIPE SUSBCRIBERS
//------------------------------------------------------------------------------
ontime({
  cycle: config.sync.discord
}, function(ot) {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Starting Stripe Database Maintenance.");
  database.checkDonors();
  ot.done();
  console.info("["+bot.getTime("stamp")+"] [wall.js] Stripe Database Maintenance Complete.");
  return;
}); */
//------------------------------------------------------------------------------
//  SYNC STRIPE CUSTOMER IDs
//------------------------------------------------------------------------------
ontime({
  cycle: config.sync.stripe
}, function(ot) {
  stripe.customer.list();
  ot.done();
  return;
});
//------------------------------------------------------------------------------
//  LISTEN ON SPECIFIED PORT
//------------------------------------------------------------------------------
server.listen(config.listening_port, () => {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Now Listening on port "+config.listening_port+".");
});