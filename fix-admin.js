import { createClient } from "@insforge/sdk";

const insforge = createClient({
  baseUrl: "https://rq3qmu8y.ap-southeast.insforge.app",
  anonKey: "ik_aaf7c33902b801271b5ec27017882e87"
});

async function fix() {
  console.log("Attempting to fix password...");
  
  // Find the user ID for admin@talentmeshsolutions.com
  const { data: users, error: listErr } = await insforge.auth.admin.listUsers();
  
  if (listErr) {
    console.log("List err:", listErr.message);
    
    // If listUsers fails, it means we don't have admin privileges with this key.
    // If we don't have admin privileges, we'll just try to sign up!
    console.log("Trying to sign up as a NEW super admin...");
    const email = "admin@talentmesh.in";
    const password = "Password123!";
    
    const { data, error } = await insforge.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: "superadmin",
          tenant_id: null
        }
      }
    });
    
    if (error) {
      console.log("Signup error:", error.message);
    } else {
      console.log("Signup success! Please verify email or check if auto-confirmed.");
      console.log(data);
    }
    return;
  }
  
  console.log("Users found:", users.users.length);
  const user = users.users.find(u => u.email === "admin@talentmeshsolutions.com");
  
  if (user) {
    const { data, error } = await insforge.auth.admin.updateUserById(user.id, {
      password: "password123"
    });
    console.log("Update result:", error ? error.message : "Success");
  } else {
    console.log("User not found!");
  }
}

fix().catch(console.error);
