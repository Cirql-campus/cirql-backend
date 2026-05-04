async function testRegister() {
  try {
    console.log("Sending registration request...");
    const res = await fetch("http://localhost:5000/api/v1/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        name: "havbyiil",
        email: "fvygayig@kiet.edu",
        password: "Password123!"
      })
    });
    
    console.log("Status:", res.status);
    const data = await res.text();
    console.log("Response:", data);
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

testRegister();
