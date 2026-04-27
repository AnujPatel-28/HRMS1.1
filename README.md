# TalentMesh HRM

TalentMesh HRM is a modern, full-stack Human Resource Management platform designed to streamline workforce operations, enhance employee engagement, and automate routine HR tasks. Built with a focus on speed, security, and a premium user experience.

## 🚀 Tech Stack

- **Frontend**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Backend & Auth**: [InsForge SDK](https://insforge.com)
- **Routing**: React Router DOM v6

## ✨ Key Features

### 🏢 HR Administration Portal
- **Workforce Dashboard**: High-level overview of team status, attendance, and pending tasks.
- **Employee Management**: Create, update, and manage detailed employee profiles and credentials.
- **Attendance Tracking**: Monitor real-time punch-in/out logs and attendance history.
- **Leave Management**: Review, approve, or reject employee leave requests with automated notifications.
- **Task Orchestration**: Assign, track, and manage departmental tasks with status updates.
- **Policy Management**: Centralized repository for company policies and documents.
- **Company Calendar**: Manage holidays and key organizational events.
- **Direct Messaging**: Real-time chat channels for seamless communication with the team.

### 👤 Employee Self-Service Portal
- **Personal Dashboard**: Quick access to tasks, attendance status, and leave balances.
- **Smart Attendance**: One-click punch-in/out with location-aware logging.
- **My Tasks**: Track assigned duties, update progress, and mark completions.
- **Leave Requests**: Easy-to-use interface for submitting and tracking leave applications.
- **Profile Management**: View and manage personal information.
- **Digital Policy Access**: Access all company guidelines and documents on the go.
- **Real-time Chat**: Connect with HR and colleagues through secure messaging.

### ⚙️ Automation & Backend
- **Edge Functions**: Automated workflows for:
  - Daily incomplete task marking.
  - Leave review notifications.
  - Automated employee user creation.
  - Punch-out gatekeeping.
- **Real-time Synchronization**: Powered by InsForge for instant updates across the platform.

## 🛠️ Getting Started

### Prerequisites
- Node.js (Latest LTS recommended)
- npm or yarn

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/VisXhal06/HRMS-Talentmesh-Solutions.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   Create a `.env` file based on `.env.example` and add your InsForge credentials.

### Development
Start the development server:
```bash
npm run dev
```

### Production
Build the application for production:
```bash
npm run build
```

## 📁 Project Structure

```text
├── functions/          # Backend Edge Functions (Deno/Typescript)
├── src/
│   ├── employee/       # Employee portal views and components
│   ├── hr/             # HR administration views and components
│   ├── shared/         # Common UI components, login, and chat
│   ├── hooks/          # Custom React hooks for data fetching
│   ├── contexts/       # Auth and Global state management
│   ├── insforge/       # Backend client configuration
│   └── types/          # TypeScript definitions
├── public/             # Static assets
└── tailwind.config.ts  # Design system configuration
```

## 📄 License

This project is proprietary and confidential.

---
*Built with ❤️ by the TalentMesh Team.*
```
