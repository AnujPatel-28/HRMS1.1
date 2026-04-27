import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

// HolidayList is consolidated into LeaveManagement's "Holiday List" tab
export default function HolidayList() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/hr/leaves", { replace: true });
  }, [navigate]);
  return null;
}
