"use client";
import React, { useState, createContext, useContext } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { cn } from "../../utils/cn";

interface Links {
  label: string;
  href: string;
  icon: React.JSX.Element | React.ReactNode;
}

interface SidebarContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

const SidebarContext = createContext<SidebarContextProps | undefined>(
  undefined
);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
};

export const SidebarProvider = ({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  const [openState, setOpenState] = useState(true);

  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate: animate }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const Sidebar = ({
  children,
  open,
  setOpen,
  animate,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  return (
    <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
      {children}
    </SidebarProvider>
  );
};

export const DesktopSidebar = ({
  className,
  children,
  showToggle = true,
  ...props
}: {
  className?: string;
  children?: React.ReactNode;
  showToggle?: boolean;
} & Omit<React.ComponentProps<typeof motion.div>, "children">) => {
  const { open, setOpen, animate } = useSidebar();
  return (
    <motion.div
      className={cn(
        "hidden md:flex md:flex-col shrink-0 relative group/desktop-sidebar",
        className
      )}
      animate={{
        width: animate ? (open ? "240px" : "56px") : "240px",
      }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      {...props}
    >
      {/* Collapse/Expand toggle button */}
      {showToggle && (
        <button
          onClick={() => setOpen(!open)}
          className="absolute -right-3 top-[52px] z-50 h-6 w-6 rounded-full border border-slate-200 bg-white flex items-center justify-center shadow-md hover:bg-slate-50 hover:text-brand-700 transition-all text-slate-400 group/toggle focus:outline-none md:opacity-0 md:group-hover/desktop-sidebar:opacity-100 transition-opacity duration-200"
          title={open ? "Collapse sidebar" : "Expand sidebar"}
        >
          {open ? (
            <ChevronLeft className="h-4 w-4 transition-transform group-hover/toggle:-translate-x-0.5" />
          ) : (
            <ChevronRight className="h-4.5 w-4.5 transition-transform group-hover/toggle:translate-x-0.5" />
          )}
        </button>
      )}
      {children}
    </motion.div>
  );
};

export const SidebarLink = ({
  link,
  className,
  children,
  onClick,
  isActive,
  ...props
}: {
  link: Links;
  className?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  isActive?: boolean;
}) => {
  const { open, animate } = useSidebar();
  return (
    <Link
      to={link.href}
      onClick={onClick}
      title={!open ? link.label : undefined}
      className={cn(
        "relative flex items-center justify-between group/sidebar py-2.5 px-2 rounded-lg transition-colors duration-150",
        className
      )}
      {...(props as any)}
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Icon — always visible, never moves */}
        <div className="h-[18px] w-[18px] shrink-0 flex items-center justify-center">
          {link.icon}
        </div>

        {/* Label — slides in/out with width animation so icon stays pinned */}
        <motion.span
          initial={false}
          animate={{
            width: animate ? (open ? "auto" : 0) : "auto",
            opacity: animate ? (open ? 1 : 0) : 1,
          }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          className="overflow-hidden whitespace-nowrap text-sm font-medium leading-none"
        >
          {link.label}
        </motion.span>
      </div>

      {/* Badge slot — only shows when expanded */}
      <AnimatePresence>
        {open && children && (
          <motion.div
            initial={{ opacity: 0, scale: 0.75 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.75 }}
            transition={{ duration: 0.15 }}
            className="shrink-0 ml-1"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </Link>
  );
};
