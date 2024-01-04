const ontime = require("ontime");
const moment = require("moment");
const express = require("express");
const path = require('path');
const fs = require('fs');
const discord = require("discord.js");
const bodyParser = require("body-parser");
const cookieSession = require("cookie-session");
const bot = require(__dirname+"/modules/bot.js");
const oauth2 = require(__dirname+"/modules/oauth2.js");
const stripe = require(__dirname+"/modules/stripe.js");
const database = require(__dirname+"/modules/database.js");
const config = require(__dirname+"/config/config.json");

//------------------------------------------------------------------------------
//  SERVER CONFIGURATIONS
//------------------------------------------------------------------------------
var sessionAge = 86400000;
const server = express();
server.engine("html", require("ejs").renderFile);

server.use(cookieSession({
  name: "session",
  keys: [config.server.session_key],
  maxAge: sessionAge,
}));
server.use(bodyParser.urlencoded({
  extended: true
}));
server.use(
  express.json({
    verify: function (req, res, buf) {
      if (req.originalUrl.startsWith("/webhook")) {
        req.rawBody = buf.toString();
      }
    },
  })
);
//------------------------------------------------------------------------------
// LANDING PAGE
//------------------------------------------------------------------------------
server.get("/", async function(req, res) {
  let radar_script = '';
  if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
  return res.render(__dirname+"/html/main.ejs", {
    terms: config.pages.general.terms,
    disclaimer: config.pages.general.disclaimer,
    warning: config.pages.general.warning,
    background: config.pages.general.background,
    outer_background: config.pages.general.outer_background,
    border_color: config.pages.general.border_color,
    title_color: config.pages.general.title_color,
    text_color: config.pages.general.text_color,
    site_name: config.server.site_name,
    site_url: config.server.site_url,
    login_url: config.discord.redirect_url,
    radar_script: radar_script
  });
});
//------------------------------------------------------------------------------
//  LOGIN/OAUTH FLOW
//------------------------------------------------------------------------------
server.get("/login", async (req, res) => {
  let time_now = moment().valueOf();
  let unix = moment().unix();
  req.session.now = unix;
  req.session.login = false;
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
    try {
      data = await oauth2.fetchAccessToken(req.query.code);
      if (data.response) {
        throw data.response;
      }
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to fetch Tokens", e);
      return res.redirect(`/error`);
    }
    let token_expiration = (unix+data.expires_in);
    try {
      user = await oauth2.fetchUser(data.access_token);
      if (user.response) {
        throw user.response;
      }
    } catch (e) {      
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to fetch User from Oauth2", e);
      return res.redirect(`/error`);
    }
    try {
      if (bot.blacklisted.indexOf(user.id) >= 0) {
        console.info("["+bot.getTime("stamp")+"] [wall.js] Blacklist Login Attempt.");
        bot.sendEmbed(user.username, user.id, "FF0000", "Blacklist Login Attempt", "", config.discord.log_channel);
        return res.redirect(`/blocked`);
      } else { 
        console.info("["+bot.getTime("stamp")+"] [wall.js] User Passed Blacklist");
      }
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Blacklist Check Failure", e);
      return res.redirect(`/error`)
    }
    try {
      member = await bot.guilds.cache.get(config.discord.guild_id).members.cache.get(user.id);
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Guild Member Fetch Failure", e);
      return res.redirect(`/error`)
    }
    if (!member) {
      try {
        console.info("["+bot.getTime("stamp")+"] [wall.js] "+user.username+" not a Guild Member, adding.");
        await oauth2.joinGuild(data.access_token, config.discord.guild_id, user.id);
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to join User to Guild", e);
        return res.redirect(`/error`);
      }
    }
    try {
      database.runQuery(`INSERT INTO stripe_users (user_id, user_name, email, access_token, refresh_token, token_expiration) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_name=VALUES(user_name), email=VALUES(email), access_token=VALUES(access_token), refresh_token=VALUES(refresh_token), token_expiration=VALUES(token_expiration)`, [user.id, user.username, user.email, data.access_token, data.refresh_token, token_expiration]);
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Insert/Update Database User", e);
      return res.redirect(`/error`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      dbuser = await database.fetchUser(user.id);
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to fetch Database User", e);
      return res.redirect(`/error`);
    }
    let customer;
    if (!dbuser.stripe_id) {
      try {
        customer = await stripe.customer.create(dbuser.user_name, dbuser.user_id, dbuser.email);
        dbuser.stripe_id = customer.id;
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Create Stripe Customer", e);
        return res.redirect(`/error`);
      }
    } else {
      try {
        customer = await stripe.customer.fetch(dbuser.stripe_id);
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Fetch Stripe Customer", e);
        return res.redirect(`/error`);
      }
    }
    if (customer && customer != 'ERROR') {
      console.info("["+bot.getTime("stamp")+"] [wall.js] Found Stripe Info for User "+dbuser.user_name);
      if (dbuser.user_id != customer.description) {
        bot.sendEmbed(dbuser.user_name, dbuser.user_id, "FF0000", "User ID Discrepancy Found", "User "+dbuser.user_name+"'s Discord ID ("+dbuser.user_id+") not found on matched Stripe Record ("+customer.id+","+customer.description+")", config.discord.log_channel);
        req.session = null;
        return res.redirect(`/error`);
      }
      if (dbuser.email != customer.email || dbuser.user_name != customer.name) {
        try {
          await stripe.customer.update(dbuser.stripe_id, dbuser.email, dbuser.user_name);
        } catch (e) {
          req.session = null;
          console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update Stripe Customer", e);
          return res.redirect(`/error`);
        }
      }
      if (customer.subscriptions && customer.subscriptions.total_count > 0) {
        for (let i = 0; i < config.stripe.price_ids.length; i++) {
          for (let x = 0; x < customer.subscriptions.data.length; x++) {
            if (customer.subscriptions.data[x].status == 'active' && customer.subscriptions.data[x].items.data[0].price.id && customer.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
              if (!dbuser.price_id || dbuser.price_id && dbuser.price_id != customer.subscriptions.data[x].items.data[0].price.id || !dbuser.expiration || dbuser.expiration && dbuser.expiration != customer.subscriptions.data[x].current_period_end) {
                try {
                  await database.runQuery('UPDATE stripe_users SET customer_type = ?, price_id = ?, expiration = ? WHERE user_id = ?', ['subscriber', customer.subscriptions.data[x].items.data[0].price.id, customer.subscriptions.data[x].current_period_end, dbuser.user_id]);
                  
                } catch (e) {
                  req.session = null;
                  console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update Subscription Price Record", e);
                  return res.redirect(`/error`);
                }
                dbuser.customer_type = 'subscriber'
                dbuser.price_id = customer.subscriptions.data[x].items.data[0].price.id;
                dbuser.expiration = customer.subscriptions.data[x].current_period_end;
                console.info("["+bot.getTime("stamp")+"] [wall.js] Updated DB Info for User "+dbuser.user_name+ ","+dbuser.user_id+"(Invalid/Missing Plan Updated)");
              }
            }
          }
        }
      }
      if (dbuser.price_id || dbuser.expiration) {
        if (dbuser.expiration && dbuser.expiration < unix) {
          try {
            await database.runQuery(`UPDATE stripe_users SET customer_type = 'inactive', price_id = NULL, expiration = NULL WHERE user_id = ?`, [dbuser.user_id]);
            await database.updateActiveVotes(dbuser.user_id, 0);
            await database.updateZoneRoles(dbuser.user_id, null, 'all','remove');
          } catch (e) {
            req.session = null;
            console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update Temp Access Price Record", e);
            return res.redirect(`/error`);
          }
          dbuser.customer_type = 'inactive';
          dbuser.price_id = null;
          dbuser.expiration = null;
          console.info("["+bot.getTime("stamp")+"] [wall.js] Updated DB Info for User "+dbuser.user_name+ ","+dbuser.user_id+"(Invalid Plan Deleted)");
        }
      }
    }
    req.session.login = true;
    req.session.discord_id = user.id;
    if (dbuser.customer_type == 'new' && dbuser.terms_reviewed == 'false' && dbuser.zones_reviewed == 'false') {
      return res.redirect(`/new`);
    } else if (dbuser.terms_reviewed == 'true' && dbuser.zones_reviewed == 'false') {
      return res.redirect(`zonemap`);
    } else {
      return res.redirect(`/manage`);
    }
  }
});
//------------------------------------------------------------------------------
//  NEW USER PAGE
//------------------------------------------------------------------------------
server.get("/new", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+1800) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
   return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  }
  let dbuser = await database.fetchUser(req.session.discord_id);
  let radar_script = '';
  if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
  return res.render(__dirname+"/html/terms.ejs", {
    terms: config.pages.general.terms,
    disclaimer: config.pages.general.disclaimer,
    warning: config.pages.general.warning,
    background: config.pages.general.background,
    outer_background: config.pages.general.outer_background,
    border_color: config.pages.general.border_color,
    title_color: config.pages.general.title_color,
    text_color: config.pages.general.text_color,
    site_name: config.server.site_name,
    site_url: config.server.site_url,
    radar_script: radar_script,
    userid: req.session.discord_id,
    username: dbuser.user_name
  });
});
server.post("/new", async function(req,res){
  let userid = req.body.userid;
  await database.termsReviewed(userid);
  res.redirect('/zonemap');
})
//------------------------------------------------------------------------------
//  ZONE MAP PAGE
//------------------------------------------------------------------------------
server.get("/zonemap", async function(req, res) {
  let unix = moment().unix();

  if (!req.session.login || unix > req.session.now+1800) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
   return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  }
  let dbuser = await database.fetchUser(req.session.discord_id);
  if (dbuser.terms_reviewed == 'false') {
   return res.redirect(`/new`);
  }
  let radar_script = '';
  let zones = await database.fetchZones();

  if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
  return res.render(__dirname+"/html/zonemap.ejs", {
    terms: config.pages.general.terms,
    disclaimer: config.pages.general.disclaimer,
    warning: config.pages.general.warning,
    background: config.pages.general.background,
    outer_background: config.pages.general.outer_background,
    border_color: config.pages.general.border_color,
    title_color: config.pages.general.title_color,
    text_color: config.pages.general.text_color,
    site_name: config.server.site_name,
    site_url: config.server.site_url,
    radar_script: radar_script,
    user: dbuser,
    zones: zones

  });
});

server.post("/zonemap", async function(req,res){
  const userid = req.body.userid;
  const usertype = req.body.userid;
  const newZone = req.body.newZone;
  const newParentZone = req.body.newParentZone;
  const selection = req.body.selection;
  const reviewed = req.body.zonesreviewed;
  await database.updateZoneSelection(userid, selection);
  if(usertype != 'inactive' && usertype != 'lifetime-inactive')  //add to total user count if active
  {
    await database.updateZoneUsers(newZone, newParentZone);
    await database.updateZoneRoles(userid, selection);

  }
  if(reviewed == 'true')
    res.redirect('/zonemap');
  else
    res.redirect('/manage');
})

//------------------------------------------------------------------------------
//  ZONE REPORT PAGE
//------------------------------------------------------------------------------
server.get("/report", async function(req, res) {
  let unix = moment().unix();
  let dbuser = await database.fetchUser(req.session.discord_id);
  if (!req.session.login || unix > req.session.now+1800) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
   return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  }
  let radar_script = '';
  let zones = await database.fetchZones();
  let user_totals = await database.calcZoneUsers();
  let allAreaTotal = user_totals[0].count;
  if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
  return res.render(__dirname+"/html/report.ejs", {
    terms: config.pages.general.terms,
    disclaimer: config.pages.general.disclaimer,
    warning: config.pages.general.warning,
    background: config.pages.general.background,
    outer_background: config.pages.general.outer_background,
    border_color: config.pages.general.border_color,
    title_color: config.pages.general.title_color,
    text_color: config.pages.general.text_color,
    site_name: config.server.site_name,
    site_url: config.server.site_url,
    radar_script: radar_script,
    usertype : dbuser.customer_type,
    zones: zones,
    workers: config.service_zones.workers,
    allAreaTotal: allAreaTotal
  });
});

server.post("/report", async function(req,res){
  const overrides = req.body.overrides[0];
  for(var i = 0 ; i < overrides.zone.length ; i++){
    await database.updateZoneOverride(overrides.overrides[i], overrides.zone[i]);
  }
  await database.updateWorkerCalc(config.service_zones.workers);
  res.redirect('/report');
})
//------------------------------------------------------------------------------
//  STRIPE CHECKOUT
//------------------------------------------------------------------------------
server.post("/create-checkout-session", async (req, res) => {
  return stripe.sessions.checkout(req, res);
});
//------------------------------------------------------------------------------
//  STRIPE CUSTOMER PORTAL
//------------------------------------------------------------------------------
server.post("/create-customer-portal-session", async (req, res) => {
  return stripe.sessions.portal(req, res);
});
//------------------------------------------------------------------------------
//  LIFETIME ACTIVE TOGGLE
//------------------------------------------------------------------------------
server.post("/lifetime-toggle", async (req, res) => {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+1800 || !req.body) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' - Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else {
    let dbuser = await database.fetchUser(req.session.discord_id);
    if (req.body.action == "activate") {
      bot.assignRole(config.discord.guild_id, req.session.discord_id, config.discord.lifetime_role, dbuser.user_name, dbuser.access_token);
      bot.removeRole(config.discord.guild_id, req.session.discord_id, config.discord.inactive_lifetime_role, dbuser.user_name);
      await database.updateActiveVotes(req.session.discord_id, 1);
      await database.updateZoneRoles(req.session.discord_id);
      database.runQuery('UPDATE stripe_users SET customer_type = ?, expiration = ? WHERE user_id = ?', ['lifetime-active', 9999999999, req.session.discord_id]);
      await new Promise(resolve => setTimeout(resolve, 500));
      return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
    } else if (req.body.action == "deactivate") {
      bot.assignRole(config.discord.guild_id, req.session.discord_id, config.discord.inactive_lifetime_role, dbuser.user_name, dbuser.access_token);
      bot.removeRole(config.discord.guild_id, req.session.discord_id, config.discord.lifetime_role, dbuser.user_name);
      await database.updateActiveVotes(req.session.discord_id, 0);
      await database.updateZoneRoles(req.session.discord_id);
      database.runQuery('UPDATE stripe_users SET customer_type = ?, expiration = ? WHERE user_id = ?', ['lifetime-inactive', 9999999998, req.session.discord_id]);
      await new Promise(resolve => setTimeout(resolve, 500));
      return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
    } else {
      return res.redirect(`/error`);
    }
  }
});
//------------------------------------------------------------------------------
//  BLOCKED PAGE
//------------------------------------------------------------------------------
server.get("/blocked", async function(req, res) {
  let radar_script = '';
  if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
  return res.render(__dirname+"/html/blocked.html", {
    background: config.pages.blocked.background,
    outer_background: config.pages.blocked.outer_background,
    border_color: config.pages.blocked.border_color,
    title_color: config.pages.blocked.title_color,
    button_link: config.pages.blocked.button_link,
    button_text: config.pages.blocked.button_text,
    site_name: config.server.site_name,
    radar_script: radar_script
  });
});
//------------------------------------------------------------------------------
//  ERROR PAGE
//------------------------------------------------------------------------------
server.get("/error", async function(req, res) {
  let radar_script = '';
  if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
  return res.render(__dirname+"/html/error.html", {
    terms: config.pages.general.terms,
    disclaimer: config.pages.general.disclaimer,
    warning: config.pages.general.warning,
    background: config.pages.general.background,
    outer_background: config.pages.general.outer_background,
    border_color: config.pages.general.border_color,
    title_color: config.pages.general.title_color,
    text_color: config.pages.general.text_color,
    site_name: config.server.site_name,
    site_url: config.server.site_url,
    radar_script: radar_script
  });
});
//------------------------------------------------------------------------------
//  PRODUCTS CHECKOUT PAGE (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/checkout", async function(req, res) {
  let unix = moment().unix();
  
  if (!req.session.login || unix > req.session.now+1800) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed, Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.customer_type == 'true' && req.session.expiration-86400 > unix && req.session.expiration < 9999999997) {
    return res.redirect(`/manual`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999999) {
    return res.redirect(`/lifetime-active`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999998) {
    return res.redirect(`/lifetime-inactive`);
  } else if (req.session.price_id && req.session.expiration-86400 > unix) {
    return res.redirect(`/expiry`);
  } else if (req.session.price_id && !req.session.expiration) {
    return res.redirect(`/manage`);
  } else {
    
    let checkoutbody = '';
    for (let i = 0; i < config.stripe.price_ids.length; i++) {
      if (config.stripe.price_ids[i].mode != 'legacy') {
        let pricehtml = '<div><h2><font color="'+config.pages.general.title_color+'">'+config.stripe.price_ids[i].title+'</font></h2><p><strong><font color="'+config.pages.general.text_color+'">'+config.stripe.price_ids[i].text+'</font></strong></p><form action="/create-checkout-session" method="post"><input type="hidden" name="priceID" value="'+config.stripe.price_ids[i].id+'" /><input type="hidden" name="mode" value="'+config.stripe.price_ids[i].mode+'" /><input type="hidden" name="customerID" value="'+req.session.stripe_id+'" /><button type="submit">Continue</button></form></div><br><hr>';
        checkoutbody = checkoutbody+pricehtml;
      }
    }
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/checkout.html", {
      welcome: config.pages.checkout.welcome,
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      checkoutbody: checkoutbody,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  CUSTOMER PORTAL PAGE
//------------------------------------------------------------------------------
server.get("/manage", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+1800) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' -  Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  }
  var dbuser = await database.fetchUser(req.session.discord_id);
  if (dbuser.terms_reviewed == 'false') {
    return res.redirect(`/new`);
  }
  if (dbuser.zones_reviewed == 'false') {
    return res.redirect(`/zonemap`);
  }
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/manage.ejs", {
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      customerID: req.session.stripe_id,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      plans: config.stripe.price_ids,
      donations: config.stripe.donation_ids,
      voteworth: config.service_zones.vote_worth,
      discord: config.discord,
      user: dbuser
    });
});

server.post("/manage", async function(req,res){

  const userid = req.body.userid;
  const usertype = req.body.usertype;
  const selection = req.body.selection;
  const removeZone = req.body.remZone;
  const removeParentZone = req.body.remParentZone;
  const format = req.body.format;

  var zonediff = req.body.zonedifferences;
  zonediff = zonediff.split('|')
  await database.updateZoneSelection(userid, selection, format);
  if(usertype != 'inactive' && usertype != "lifetime-inactive") //adjust zone values only if active user
  {
    if(removeZone != '') //removing a zone. Decrease total users from zone.
    {
      await database.updateZoneUsers(removeZone,removeParentZone,0);
      await database.updateZoneRoles(userid,selection,removeZone)
    }
    else
    {
      await database.updateZoneRoles(userid,selection)
    }
    for(var i = 0 ; i < zonediff.length ; i++) //adjusting vote counts
    {
      await database.updateTotalVotes(zonediff[i]);
      await database.updateParentVotes(zonediff[i]);        
    }
  }
  await database.updateWorkerCalc(config.service_zones.workers);
  res.redirect('/manage');
})
//------------------------------------------------------------------------------
//  ACTIVE Pay-As-You-Go CUSTOMER PAGE  (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/expiry", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+600) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' -   Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.customer_type == 'true' && req.session.expiration-86400 > unix && req.session.expiration < 9999999997) {
    return res.redirect(`/manual`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999999) {
    return res.redirect(`/lifetime-active`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999998) {
    return res.redirect(`/lifetime-inactive`);
  } else if (req.session.price_id && !req.session.expiration) {
    return res.redirect(`/manage`);
  } else if (!req.session.price_id) {
    return res.redirect(`/checkout`);
  } else {
    let expiry = new Date(req.session.expiration * 1000).toLocaleString(config.server.tz_locale, { timeZone: config.server.time_zone });
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/expiry.html", {
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      customerID: req.session.stripe_id,
      expiry: expiry,
      tz_text: config.server.tz_text,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  MANUAL USER PAGE (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/manual", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+600) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' - Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.price_id && req.session.expiration-86400 > unix) {
    return res.redirect(`/expiry`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999999) {
    return res.redirect(`/lifetime-active`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999998) {
    return res.redirect(`/lifetime-inactive`);
  } else if (req.session.price_id && !req.session.expiration) {
    return res.redirect(`/manage`);
  } else if (!req.session.customer_type || req.session.customer_type && req.session.expiration-86400 < unix) {
    return res.redirect(`/checkout`);
  } else {
    let intro = config.pages.manual.manual_intro;
    let exp_text = config.pages.manual.manual_text;
    let expiry = new Date(req.session.expiration * 1000).toLocaleString(config.server.tz_locale, { timeZone: config.server.time_zone });
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/manual.html", {
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      expiry: expiry,
      tz_text: config.server.tz_text,
      intro: intro,
      exp_text: exp_text,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  ACTIVE LIFETIME USER PAGE (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/lifetime-active", async function(req, res) {
  let unix = moment().unix();
  if (!req.session.login || unix > req.session.now+600) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' - Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.price_id && req.session.expiration-86400 > unix && req.session.expiration < 9999999997) {
    return res.redirect(`/expiry`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999998) {
    return res.redirect(`/lifetime-inactive`);
  } else if (req.session.price_id && !req.session.expiration) {
    return res.redirect(`/manage`);
  } else if (!req.session.customer_type || req.session.customer_type && req.session.expiration-86400 < unix) {
    return res.redirect(`/checkout`);
  } else {
    
    let intro = config.pages.lifetime.active_life_intro;
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/lifetime-active.html", {
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      intro: intro,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      user_id: req.session.discord_id,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  INACTIVE LIFETIME USER PAGE (TO BE DELETED)
//------------------------------------------------------------------------------
server.get("/lifetime-inactive", async function(req, res) {
  let unix = moment().unix();
  
  if (!req.session.login || unix > req.session.now+600) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Direct Link Accessed or Data 'Old' - Sending to Login");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  } else if (req.session.price_id && req.session.expiration-86400 > unix && req.session.expiration < 9999999997) {
    return res.redirect(`/expiry`);
  } else if (req.session.customer_type == 'true' && req.session.expiration === 9999999999) {
    return res.redirect(`/lifetime-active`);
  } else if (req.session.price_id && !req.session.expiration) {
    return res.redirect(`/manage`);
  } else if (!req.session.customer_type || req.session.customer_type && req.session.expiration-86400 < unix) {
    return res.redirect(`/checkout`);
  } else { 
    let intro = config.pages.lifetime.inactive_life_intro;
    let radar_script = '';
    if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
    return res.render(__dirname+"/html/lifetime-inactive.html", {
      terms: config.pages.general.terms,
      disclaimer: config.pages.general.disclaimer,
      warning: config.pages.general.warning,
      background: config.pages.general.background,
      outer_background: config.pages.general.outer_background,
      border_color: config.pages.general.border_color,
      title_color: config.pages.general.title_color,
      text_color: config.pages.general.text_color,
      intro: intro,
      site_name: config.server.site_name,
      site_url: config.server.site_url,
      radar_script: radar_script,
      user_name: req.session.username,
      user_id: req.session.discord_id,
      email: req.session.email
    });
  }
});
//------------------------------------------------------------------------------
//  SRIPE WEBHOOKS
//------------------------------------------------------------------------------
server.post("/webhook", async (req, res) => {
  return stripe.webhookVerify(req, res);
});
//------------------------------------------------------------------------------
//  STRIPE, DATABASE, ROLE & DISCORD INFO MAINTENANCE
//------------------------------------------------------------------------------
ontime({
  cycle: config.sync.times
}, function(ot) {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Starting Maintenance Routines.");
  database.checkDetails();
  ot.done();
  return;
});
//------------------------------------------------------------------------------
//  LISTEN ON SPECIFIED PORT
//------------------------------------------------------------------------------
server.listen(config.server.listening_port, () => {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Now Listening on port "+config.server.listening_port+".");
});