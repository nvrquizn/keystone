import fs from 'node:fs';
import path from 'node:path';
import {ChannelType,Events,MessageFlags,PermissionFlagsBits as P,SlashCommandBuilder} from 'discord.js';
import type {Client} from 'discord.js';
import type {BotCommand} from '../lib/command.js';

type T={guild:string;channel:string;until:number;perms:{id:string;old:boolean|null}[]};
const file=()=>path.join(process.env.DATA_DIR||path.join(process.cwd(),'data'),'keystone-lockdowns.json');
const key=(g:string,c:string)=>g+':'+c;
const busy=new Set<string>();

function read():Record<string,T>{
 try{return JSON.parse(fs.readFileSync(file(),'utf8'));}
 catch{return {};}
}
function save(x:Record<string,T>){
 fs.mkdirSync(path.dirname(file()),{recursive:true});
 fs.writeFileSync(file()+'.tmp',JSON.stringify(x));
 fs.renameSync(file()+'.tmp',file());
}
const old=(x:any)=>x?.allow.has(P.SendMessages)?true:x?.deny.has(P.SendMessages)?false:null;
const staff=(r:any)=>[P.Administrator,P.ManageChannels,P.ManageMessages,P.ModerateMembers].some(p=>r.permissions.has(p));

async function end(client:Client,x:T){
 const k=key(x.guild,x.channel);
 if(busy.has(k))return;
 busy.add(k);
 try{
  const g=await client.guilds.fetch(x.guild);
  const ch=await g.channels.fetch(x.channel);
  if(ch&&ch.type===ChannelType.GuildText){
   for(const p of x.perms){
    await ch.permissionOverwrites.edit(p.id,{SendMessages:p.old},{reason:'Timed lockdown ended'});
   }
  }
  const a=read();
  if(a[k]?.until===x.until){delete a[k];save(a);}
 }finally{busy.delete(k);}
}

export function registerLockdownRecovery(client:Client){
 client.once(Events.ClientReady,()=>{
  const tick=()=>{
   for(const x of Object.values(read()))
    if(x.until<=Date.now())void end(client,x).catch(console.error);
  };
  tick();
  const t=setInterval(tick,10000);
  t.unref();
 });
}

export const lockdownCommand:BotCommand={
 data:new SlashCommandBuilder()
 .setName('lockdown')
 .setDescription('Lock channel temporarily, then automatically restore permissions.')
 .setDMPermission(false)
 .setDefaultMemberPermissions(P.ManageChannels)
 .addStringOption(o=>o.setName('reason').setDescription('Why lock the channel?').setRequired(true))
 .addIntegerOption(o=>o.setName('minutes').setDescription('Duration in minutes (default 10)').setMinValue(1).setMaxValue(120)),
 async execute(i){
  if(!i.inCachedGuild())return;
  if(!i.memberPermissions?.has(P.ManageChannels))
   return void await i.reply({content:'Manage Channels required.',flags:MessageFlags.Ephemeral});
  const ch=i.channel;
  if(!ch||ch.type!==ChannelType.GuildText)
   return void await i.reply({content:'Use a standard text channel.',flags:MessageFlags.Ephemeral});
  const k=key(i.guildId,ch.id);
  if(busy.has(k))
   return void await i.reply({content:'Another lockdown change is in progress.',flags:MessageFlags.Ephemeral});
  const mins=i.options.getInteger('minutes')??10;
  const reason=i.options.getString('reason',true);
  busy.add(k);
  await i.deferReply({flags:MessageFlags.Ephemeral});
  try{
   const locks=read();
   const targets=new Map<string,boolean>([[i.guildId,false]]);
   for(const o of ch.permissionOverwrites.cache.values()){
    if(o.id===i.guildId||!o.allow.has(P.SendMessages))continue;
    const r=i.guild.roles.cache.get(o.id);
    targets.set(o.id,!!r&&staff(r));
   }
   for(const r of i.guild.roles.cache.values()){
    if(r.id===i.guildId||r.permissions.has(P.Administrator)||!staff(r))continue;
    if(!ch.permissionOverwrites.cache.get(r.id)?.deny.has(P.SendMessages))
     targets.set(r.id,true);
   }
   const orig=locks[k]?.perms??[...targets.keys()].map(id=>({
    id,old:old(ch.permissionOverwrites.cache.get(id))
   }));
   locks[k]={guild:i.guildId,channel:ch.id,until:Date.now()+mins*60000,perms:orig};
   save(locks);
   for(const [id,allow] of targets)
    await ch.permissionOverwrites.edit(id,{SendMessages:allow},{reason:`Lockdown: ${reason}`.slice(0,512)});
   await i.editReply(`Locked ${ch} for ${mins} minute(s), with automatic unlock. Reason: ${reason}`);
  }catch(e){
   console.error(e);
   await i.editReply('Lockdown failed; check bot permissions and Railway logs.');
  }finally{busy.delete(k);}
 }
};

export const unlockdownCommand:BotCommand={
 data:new SlashCommandBuilder()
 .setName('unlockdown')
 .setDescription('Restore this channel before the timed lockdown expires.')
 .setDMPermission(false)
 .setDefaultMemberPermissions(P.ManageChannels),
 async execute(i){
  if(!i.inCachedGuild())return;
  if(!i.memberPermissions?.has(P.ManageChannels))
   return void await i.reply({content:'Manage Channels required.',flags:MessageFlags.Ephemeral});
  const c=i.channel;
  if(!c||c.type!==ChannelType.GuildText)
   return void await i.reply({content:'Use a text channel.',flags:MessageFlags.Ephemeral});
  const x=read()[key(i.guildId,c.id)];
  if(!x)
   return void await i.reply({content:'No active timed lockdown.',flags:MessageFlags.Ephemeral});
  await i.deferReply({flags:MessageFlags.Ephemeral});
  try{
   await end(i.client,x);
   await i.editReply(`Unlocked ${c}.`);
  }catch(e){
   console.error(e);
   await i.editReply('Unable to restore permissions; check bot logs.');
  }
 }
};
