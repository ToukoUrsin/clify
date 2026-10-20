const base=process.env.CLIFY_BASE_URL||'https://clify-dev.netlify.app'; const h={'user-agent':'clify-selftest/1','x-clify-test':'1'};
const get=async(p)=>{const r=await fetch(base+p,{headers:h});let j;try{j=await r.json()}catch{};console.log(r.status,p,JSON.stringify(j).slice(0,180));return {r,j}};
await get('/sites.json'); await get('/search?q=rust'); await get('/crates.json'); await get('/crates/get-crate?name=serde'); await get('/unknown-site'); await get('/request?url=https%3A%2F%2Fexample.com&why=selftest'); await get('/crates/get-crate');
