import * as React from "react";

// Simple utility to merge class names
const cn = (...classes: (string | undefined | null)[]) => classes.filter(Boolean).join(' ');

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
}

const getVariantClasses = (variant: ButtonProps['variant'] = 'default') => {
  switch (variant) {
    case 'default':
      return 'bg-blue-600 text-white hover:bg-blue-700';
    case 'destructive':
      return 'bg-red-600 text-white hover:bg-red-700';
    case 'outline':
      return 'border border-gray-300 bg-transparent hover:bg-gray-100';
    case 'secondary':
      return 'bg-gray-200 text-gray-900 hover:bg-gray-300';
    case 'ghost':
      return 'bg-transparent hover:bg-gray-100';
    case 'link':
      return 'bg-transparent text-blue-600 underline-offset-4 hover:underline';
    default:
      return 'bg-blue-600 text-white hover:bg-blue-700';
  }
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, ...props }, ref) => {
    return (
      <button
        className={cn(
          'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium',
          'transition-colors focus-visible:outline-none focus-visible:ring-2',
          'disabled:pointer-events-none disabled:opacity-50',
          getVariantClasses(variant),
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button }; 