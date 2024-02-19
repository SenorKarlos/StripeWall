const ontime = require("ontime");
const moment = require("moment");
const express = require("express");
const path = require('path');
const fs = require('fs');
const discord = require("discord.js");
const bodyParser = require("body-parser");
const cookieSession = require("cookie-session");
const bot = require(__dirname+"/modules/bot.js");
const database = require(__dirname+"/modules/database.js");
const maintenance = require(__dirname+"/modules/maintenance.js");
const oauth2 = require(__dirname+"/modules/oauth2.js");
const qbo = require(__dirname+"/modules/qbo.js");
const stripe = require(__dirname+"/modules/stripe.js");
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
  let unix = moment().unix();
  req.session.now = unix;
  req.session.login = false;

// Send to Discord OAUTH2 to get code
  if (!req.query.code) {
    console.info("["+bot.getTime("stamp")+"] [wall.js] Login from "+req.headers['x-forwarded-for']+". Sending User to Discord Oauth2 Authorization URL.");
    return res.redirect(`https://discord.com/api/oauth2/authorize?response_type=code&client_id=${oauth2.client_id}&scope=${oauth2.scope}&redirect_uri=${config.discord.redirect_url}`);
  }
  else {
// Fetch discord tokens with code
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
    let token_expiration = (unix + data.expires_in);
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

// Check login vs blacklist
    try {
      if (bot.blacklisted.indexOf(user.id) >= 0) {
        console.info("["+bot.getTime("stamp")+"] [wall.js] Blacklist Login Attempt.");
        bot.sendEmbed(user.username, user.id, "FF0000", "Blacklist Login Attempt", "", config.discord.log_channel);
        return res.redirect(`/blocked`);
      }
      else { 
        console.info("["+bot.getTime("stamp")+"] [wall.js] User Passed Blacklist");
      }
    } catch (e) {
      req.session = null;
      console.info("["+bot.getTime("stamp")+"] [wall.js] Blacklist Check Failure", e);
      return res.redirect(`/error`)
    }

// Check guild membership and add if required
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

// Insert/update user and pull current record
    try {
      database.runQuery(`INSERT INTO customers (user_id, user_name, email, access_token, refresh_token, token_expiration) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE user_name=VALUES(user_name), email=VALUES(email), access_token=VALUES(access_token), refresh_token=VALUES(refresh_token), token_expiration=VALUES(token_expiration)`, [user.id, user.username, user.email, data.access_token, data.refresh_token, token_expiration]);
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

// Verify or Create Stripe Customer
    if (!dbuser.stripe_data) {
      try {
        let body = {
          name: dbuser.user_name,
          description: dbuser.user_id,
          email: dbuser.email,
        }
        dbuser.stripe_data = await stripe.customer.create(body);
      } catch (e) {
        req.session = null;
        console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Create Stripe Customer", e);
        return res.redirect(`/error`);
      }
    }
    if (dbuser.stripe_data && dbuser.stripe_data != 'ERROR') {
      if (dbuser.user_id != dbuser.stripe_data.description) { // Should no longer be possible
        bot.sendEmbed(dbuser.user_name, dbuser.user_id, "FF0000", "User ID Discrepancy Found", "User "+dbuser.user_name+"'s Discord ID ("+dbuser.user_id+") not found on matched Stripe Record ("+dbuser.stripe_data.id+","+dbuser.stripe_data.description+")", config.discord.log_channel);
        req.session = null;
        return res.redirect(`/error`);
      }
      if (dbuser.email != dbuser.stripe_data.email || dbuser.user_name != dbuser.stripe_data.name) {
        try {
          let body = {
            name: dbuser.user_name,
            email: dbuser.email
          };
          dbuser.stripe_data = await stripe.customer.update(dbuser.stripe_data.id, body);
          dbuser.stripe_data = await stripe.customer.fetch(dbuser.stripe_data.id);
        } catch (e) {
          req.session = null;
          console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update Stripe Customer", e);
          return res.redirect(`/error`);
        }
      }
    }

// Verify or Create QBO Customer
    if (config.qbo.enabled) {
      if (!dbuser.qbo_data) {
        try {
          dbuser.qbo_data = await qbo.createCustomer(dbuser.user_name, dbuser.user_id, dbuser.email);
        } catch (e) {
          req.session = null;
          console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Create QBO Customer", e);
          return res.redirect(`/error`);
        }
      }
      if (dbuser.qbo_data) {
        if (dbuser.user_id != dbuser.qbo_data.CompanyName) { // Should not be possible
          bot.sendEmbed(dbuser.user_name, dbuser.user_id, "FF0000", "User ID Discrepancy Found", "User "+dbuser.user_name+"'s Discord ID ("+dbuser.user_id+") not found on matched QBO Record ("+dbuser.qbo_data.Id+","+dbuser.qbo_data.CompanyName+")", config.discord.log_channel);
          req.session = null;
          return res.redirect(`/error`);
        }
        if (dbuser.email != dbuser.qbo_data.PrimaryEmailAddr.Address || dbuser.user_name != dbuser.qbo_data.GivenName || dbuser.user_name != dbuser.qbo_data.DisplayName || dbuser.user_name != dbuser.qbo_data.PrintOnCheckName) {
          try {
            dbuser.qbo_data.PrimaryEmailAddr.Address = dbuser.email;
            dbuser.qbo_data.GivenName = dbuser.user_name;
            dbuser.qbo_data.DisplayName = dbuser.user_name;
            dbuser.qbo_data.PrintOnCheckName = dbuser.user_name;
            dbuser.qbo_data = await qbo.updateCustomer(dbuser.qbo_data);
          } catch (e) {
            req.session = null;
            console.info("["+bot.getTime("stamp")+"] [wall.js] Failed to Update QBO Customer", e);
            return res.redirect(`/error`);
          }
        }
      }
    }

// Verify customer_type, roles & record accuracy
    let verified = false;      
    if (dbuser.customer_type == 'administrator' || dbuser.customer_type == 'lifetime-active' || dbuser.customer_type == 'lifetime-inactive') {
      verified = true;
      dbuser.paygo_data = null;
      if (dbuser.customer_type == 'lifetime-inactive') {
        await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.discord.inactive_lifetime_role, dbuser.user_name);
        await bot.removeRole(config.discord.guild_id, dbuser.user_id, config.discord.lifetime_role, dbuser.user_name);
        if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, '', 'all', 'remove'); }
      }
      else if (dbuser.customer_type == 'lifetime-active') {
        await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.discord.lifetime_role, dbuser.user_name);
        await bot.removeRole(config.discord.guild_id, dbuser.user_id, config.discord.inactive_lifetime_role, dbuser.user_name);
        if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, ''); }
      }
    }
    else if (dbuser.customer_type == 'subscriber') {
      if (dbuser.stripe_data.subscriptions && dbuser.stripe_data.subscriptions.total_count > 0) {
        for (let x = 0; x < dbuser.stripe_data.subscriptions.data.length; x++) {
          for (let i = 0; i < config.stripe.price_ids.length; i++) {
            if (dbuser.stripe_data.subscriptions.data[x].items.data[0].price.id && dbuser.stripe_data.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
              if (dbuser.stripe_data.subscriptions.data[x].status == 'active') {
                await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
                if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, ''); }
                verified = true;
                dbuser.paygo_data = null;
              }
            }
          }
        }
      }
      if (!verified) {
        for (let i = 0; i < config.stripe.price_ids.length; i++) {
          await bot.removeRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
        }
        if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, '', 'all', 'remove'); }
        dbuser.customer_type = 'inactive';
      }
    }
    else if (dbuser.customer_type == 'pay-as-you-go') {
      if (dbuser.paygo_data && dbuser.paygo_data.expiration && dbuser.paygo_data.expiration > unix && dbuser.paygo_data.price_id) {
        for (let i = 0; i < config.stripe.price_ids.length; i++) {
          if (dbuser.paygo_data.price_id == config.stripe.price_ids[i].id) {
            await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
            if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, ''); }
            verified = true;
          }
        }
      }
      if (!verified) {
        for (let i = 0; i < config.stripe.price_ids.length; i++) {
          await bot.removeRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
        }
        if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, '', 'all', 'remove'); }
        dbuser.customer_type = 'inactive';
        dbuser.paygo_data = null;
      }
    }
    if (dbuser.customer_type == 'inactive') {
      if (dbuser.stripe_data.subscriptions && dbuser.stripe_data.subscriptions.total_count > 0) {
        for (let x = 0; x < dbuser.stripe_data.subscriptions.data.length; x++) {          
          for (let i = 0; i < config.stripe.price_ids.length; i++) {
            if (dbuser.stripe_data.subscriptions.data[x].items.data[0].price.id && dbuser.stripe_data.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
              if (dbuser.stripe_data.subscriptions.data[x].status != 'active') {
                await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
                if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, ''); }
                dbuser.customer_type = 'subscriber';
                dbuser.paygo_data = null;
              }
            }
          }
        }
      }
      if (dbuser.paygo_data) {
        if (dbuser.paygo_data.expiration && dbuser.paygo_data.expiration > unix && dbuser.paygo_data.price_id) {
          for (let i = 0; i < config.stripe.price_ids.length; i++) {
            if (dbuser.paygo_data.price_id == config.stripe.price_ids[i].id) {
              await bot.assignRole(config.discord.guild_id, dbuser.user_id, config.stripe.price_ids[i].role_id, dbuser.user_name);
              if (config.service_zones.roles_enabled) { await database.updateZoneRoles(dbuser.user_id, ''); }
              dbuser.customer_type = 'pay-as-you-go';
            }
          }
        }
        else {
          dbuser.paygo_data = null;
        }
      }
    }
    if (dbuser.donation_data) {
      if (dbuser.donation_data.role_ids[0] != "") {
        await bot.assignRole(config.discord.guild_id, dbuser.user_id, dbuser.donation_data.role_ids[0], dbuser.user_name);
      }
      if (dbuser.donation_data.role_ids[1] != "") {
        await bot.assignRole(config.discord.guild_id, dbuser.user_id, dbuser.donation_data.role_ids[1], dbuser.user_name);
      }
    }
    if (dbuser.paygo_data) {
      dbuser.paygo_data = JSON.stringify(dbuser.paygo_data);
    }
    await database.runQuery(`UPDATE customers SET customer_type = ?, stripe_data = ?, paygo_data = ?, qbo_data = ? WHERE user_id = ?`, [dbuser.customer_type, JSON.stringify(dbuser.stripe_data), dbuser.paygo_data, JSON.stringify(dbuser.qbo_data), dbuser.user_id]);
      
// Mark session logged in with id and redirect per status
    req.session.login = true;
    req.session.discord_id = dbuser.user_id;
    if (dbuser.terms_reviewed == 'false') {
      return res.redirect(`/terms`);
    }
    else if (dbuser.zones_reviewed == 'false' && config.service_zones.zones_enabled) {
      return res.redirect(`zonemap`);
    }
    else {
      return res.redirect(`/manage`);
    }
  }
});
//------------------------------------------------------------------------------
//  NEW USER PAGE
//------------------------------------------------------------------------------
server.get("/terms", async function(req, res) {
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
    highlight_color: config.pages.general.highlight_color,
    site_name: config.server.site_name,
    site_url: config.server.site_url,
    radar_script: radar_script,
    userid: dbuser.user_id,
    username: dbuser.user_name
  });
});
server.post("/terms", async function(req, res) {
  let userid = req.body.userid;
  await database.termsReviewed(userid);
  if (config.service_zones.zones_enabled) {
    res.redirect(`/zonemap`);
  }
  else {
    res.redirect(`/manage`);
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
  let dbuser = await database.fetchUser(req.session.discord_id);
  if (dbuser.terms_reviewed == 'false') {
    return res.redirect(`/terms`);
  }
  if (dbuser.zones_reviewed == 'false' && config.service_zones.zones_enabled) {
    return res.redirect(`/zonemap`);
  }
  let radar_script = '';
  if (config.stripe.radar_script) { radar_script = '<script async src="https://js.stripe.com/v3/"></script>'; }
  let expiration = null;
  if (dbuser.customer_type == 'pay-as-you-go') {
    expiration = dbuser.paygo_data.expiration;
  }
  else if (dbuser.customer_type == 'subscriber') {
    for (let x = 0; x < dbuser.stripe_data.subscriptions.data.length; x++) {
      for (let i = 0; i < config.stripe.price_ids.length; i++) {
        if (dbuser.stripe_data.subscriptions.data[x].items.data[0].price.id == config.stripe.price_ids[i].id) {
          expiration = dbuser.stripe_data.subscriptions.data[x].current_period_end;
        }
      }
    }
  }
  let donation_sub = false;
  if (dbuser.donation_data) {
    donation_sub = dbuser.donation_data.sub_active;
  }
  return res.render(__dirname+"/html/manage.ejs", {
    terms: config.pages.general.terms,
    disclaimer: config.pages.general.disclaimer,
    warning: config.pages.general.warning,
    background: config.pages.general.background,
    outer_background: config.pages.general.outer_background,
    border_color: config.pages.general.border_color,
    title_color: config.pages.general.title_color,
    text_color: config.pages.general.text_color,
    highlight_color: config.pages.general.highlight_color,
    button_color: config.pages.general.button_color,
    site_name: config.server.site_name,
    site_url: config.server.site_url,
    radar_script: radar_script,
    tz_locale: config.server.tz_locale,
    time_zone: config.server.time_zone,
    lifetime_role: config.discord.lifetime_role,
    lifetime_intro: config.pages.manage.active_lifetime_intro,
    inactive_lifetime_role: config.discord.inactive_lifetime_role,
    inactive_lifetime_intro: config.pages.manage.inactive_lifetime_intro,
    tz_text: config.server.tz_text,
    plans: config.stripe.price_ids,
    product_intro: config.pages.manage.product_intro,
    donations: config.stripe.donation_ids,
    donation_intro: config.pages.manage.donation_intro,
    donation_sub: donation_sub,
    voteworth: config.service_zones.vote_worth,
    available: dbuser.total_votes,
    allocations: dbuser.allocations,
    zones: dbuser.zone_votes,
    expiration: expiration,
    currentTime: unix,
    total_spend: dbuser.total_spend,
    user_id: dbuser.user_id,
    user_name: dbuser.user_name,
    cx_type: dbuser.customer_type,
    stripe_id: dbuser.stripe_data.id,
    vote_format: dbuser.format,
    zone_background: config.pages.manage.zone_background,
    zone_text: config.pages.manage.zone_text
  });
});

server.post("/manage", async function(req, res) {
  let userid = req.body.userid;
  let usertype = req.body.usertype;
  let selection = req.body.selection;
  let allocations = req.body.allocations;
  let percentage = req.body.percentage;
  let removeZone = req.body.remZone;
  let removeRoleLevel = req.body.remRoleLevel;
  let format = req.body.format;
  await database.updateZoneSelection(userid, selection, allocations, format);
  if (format == 1) { //if user's format is set to automatic, start allocating votes.  
    await database.allocateVotes(userid, allocations, percentage)
  }
  if (usertype != 'inactive' && usertype != "lifetime-inactive" && config.service_zones.roles_enabled) { //adjust zone values only if active user
    if(removeZone != '') { //removing a zone. Decrease total users from zone.
      await database.updateZoneRoles(userid, selection, removeZone, 'remove', removeRoleLevel)
    }
    else {
      await database.updateZoneRoles(userid, selection);
    }   
  }
  res.redirect('/manage');
});
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
   return res.redirect(`/terms`);
  }
  let radar_script = '';
  await database.calcZones();
  await database.updateWorkerCalc();
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
    highlight_color: config.pages.general.highlight_color,
    button_color: config.pages.general.button_color,
    site_name: config.server.site_name,
    site_url: config.server.site_url,
    zone_form: config.service_zones.new_zone_form,
    radar_script: radar_script,
    zoneSelection: dbuser.zone_votes,
    allocations: dbuser.allocations,
    zonesreviewed: dbuser.zones_reviewed,
    userid: dbuser.user_id,
    usertype: dbuser.customer_type,
    format: dbuser.format,
    zones: zones
  });
});

server.post("/zonemap", async function(req, res) {
  let userid = req.body.userid;
  let usertype = req.body.usertype;
  let format = req.body.format;
  let selection = req.body.selection;
  let allocations = req.body.allocations;
  let reviewed = req.body.zonesreviewed;
  await database.updateZoneSelection(userid, selection, allocations, format);
  if (usertype != 'inactive' && usertype != 'lifetime-inactive' && config.service_zones.roles_enabled) {
    await database.updateZoneRoles(userid, selection);
  }
  res.redirect(`/zonemap`);
});
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
  let user_totals = await database.calcZones();
  let allAreaTotal = user_totals[0].count;
  await database.updateWorkerCalc();
  let zones = await database.fetchZones();
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
    highlight_color: config.pages.general.highlight_color,
    button_color: config.pages.general.button_color,
    site_name: config.server.site_name,
    site_url: config.server.site_url,
    radar_script: radar_script,
    usertype : dbuser.customer_type,
    zones: zones,
    workers: config.service_zones.workers,
    allAreaTotal: allAreaTotal
  });
});

server.post("/report", async function(req, res) {
  let overrides = req.body.overrides[0];
  for (let i = 0 ; i < overrides.zone.length ; i++) {
    await database.updateZoneOverride(overrides.overrides[i], overrides.zone[i]);
  }
  res.redirect(`/report`);
});
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
  }
  else {
    let dbuser = await database.fetchUser(req.session.discord_id);
    if (req.body.action == "activate") {
      bot.assignRole(config.discord.guild_id, req.session.discord_id, config.discord.lifetime_role, dbuser.user_name, dbuser.access_token);
      bot.removeRole(config.discord.guild_id, req.session.discord_id, config.discord.inactive_lifetime_role, dbuser.user_name);
      database.runQuery(`UPDATE customers SET customer_type = ? WHERE user_id = ?`, ['lifetime-active', req.session.discord_id]);
      if (config.service_zones.roles_enabled) { await database.updateZoneRoles(req.session.discord_id,''); }
      await new Promise(resolve => setTimeout(resolve, 500));
      return res.redirect(`/manage`);
    }
    else if (req.body.action == "deactivate") {
      bot.assignRole(config.discord.guild_id, req.session.discord_id, config.discord.inactive_lifetime_role, dbuser.user_name, dbuser.access_token);
      bot.removeRole(config.discord.guild_id, req.session.discord_id, config.discord.lifetime_role, dbuser.user_name); 
      database.runQuery(`UPDATE customers SET customer_type = ? WHERE user_id = ?`, ['lifetime-inactive', req.session.discord_id]);
      if (config.service_zones.roles_enabled) { await database.updateZoneRoles(req.session.discord_id, '', 'all', 'remove'); }
      await new Promise(resolve => setTimeout(resolve, 500));
      return res.redirect(`/manage`);
    }
    else {
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
//  SRIPE WEBHOOKS
//------------------------------------------------------------------------------
server.post("/webhook", async (req, res) => {
  return stripe.webhookVerify(req, res);
});
//------------------------------------------------------------------------------
//  STRIPE, DATABASE, ROLE & DISCORD INFO MAINTENANCE
//------------------------------------------------------------------------------
ontime({
  cycle: config.maintenance.times
}, function(ot) {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Starting Maintenance Routines.");
  maintenance.checkDetails();
  ot.done();
  return;
});
if (config.maintenance.on_startup) {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Starting Maintenance Routines.");
  maintenance.checkDetails();
}
if (config.service_zones.zones_enabled) {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Check or Create Service Zone Table.");
  setTimeout(async function() {
    let zones = await database.fetchZones();
    if (!zones || zones.length === 0) {
      console.info("["+bot.getTime("stamp")+"] [wall.js] No Service Zone Table Present, Create.");
      let geojson;
      if (config.service_zones.init_source == 'geojson') {
        const geojsonFile = 'config/geojson.json';
        geojson = await JSON.parse(fs.readFileSync(geojsonFile, 'utf8'));
      }
      else {
        // planned koji integration
      }
      if (!geojson) {
        console.info("["+bot.getTime("stamp")+"] [wall.js] Error Reading geojson source, terminating bot.");
        process.exit(4);
      }
      geojson.features.forEach((feature, i) => {
        setTimeout(async function() {
          let data = [];
          data[0] = feature.properties.name;
          if (feature.properties.parent) {
            data[1] = feature.properties.parent;
          }
          else {
            data[1] = null;
          }
          if (feature.properties.img_url) {
            data[2] = feature.properties.img_url;
          }
          else {
            data[2] = null;
          }
          if (feature.properties.zone_roles) {
            data[3] = JSON.stringify(feature.properties.zone_roles);
          }
          else {
            data[3] = null;
          }
          let saved = await database.runQuery(`INSERT INTO service_zones (zone_name, parent_zone, img_url, zone_roles) VALUES (?, ?, ?, ?)`, data);
          if (!saved) {
            console.info("["+bot.getTime("stamp")+"] [wall.js] Error writing zone to database, terminating bot. Investigate any issues, clear table, and try again.");
            process.exit(4);
          }
        }, 100 * i);
      });
    }
    else {
      console.info("["+bot.getTime("stamp")+"] [wall.js] Service Zone Table Present.");
    }
  }, 1000);
}
//------------------------------------------------------------------------------
//  LISTEN ON SPECIFIED PORT
//------------------------------------------------------------------------------
server.listen(config.server.listening_port, () => {
  console.info("["+bot.getTime("stamp")+"] [wall.js] Now Listening on port "+config.server.listening_port+".");
});