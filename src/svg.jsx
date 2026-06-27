export default {
  theme: {
    extend: {
      keyframes: {
        float: {
          '0%, 100%': {
            transform: 'translateY(0px)',
          },
          '25%': {
            transform: 'translateY(-5px)',
          },
          '75%': {
            transform: 'translateY(5px)',
          },
        },
      },
      animation: {
        float: 'float 3s ease-in-out infinite',
      },
    },
  },
};